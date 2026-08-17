import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../config.dart';
import 'models.dart';

/// Readable, code-carrying error mirroring the backend §13 contract.
class ApiException implements Exception {
  final String code;
  final String message;
  final int statusCode;
  final dynamic details;
  ApiException(this.code, this.message, this.statusCode, [this.details]);

  bool get isUnauthorized => statusCode == 401;

  @override
  String toString() => message;
}

/// Persists the JWT across launches (SharedPreferences) with an in-memory cache.
class TokenStore {
  static const _key = 'opd_admin_token';
  String? _token;

  String? get token => _token;

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    _token = prefs.getString(_key);
  }

  Future<void> set(String token) async {
    _token = token;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, token);
  }

  Future<void> clear() async {
    _token = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_key);
  }
}

class ApiClient {
  final String base = AppConfig.apiBaseUrl;
  final TokenStore tokens;

  /// Invoked whenever the server rejects the token (401) so the app can
  /// return the user to the login screen.
  void Function()? onUnauthorized;

  ApiClient(this.tokens);

  Uri _uri(String path, [Map<String, dynamic>? query]) =>
      Uri.parse('$base$path').replace(
        queryParameters: query?.map((k, v) => MapEntry(k, '$v')),
      );

  Map<String, String> _headers({bool json = true}) => {
        if (json) 'Content-Type': 'application/json',
        'Accept': 'application/json',
        if (tokens.token != null) 'Authorization': 'Bearer ${tokens.token}',
      };

  MediaType _imageMediaType(String path) {
    final ext = path.toLowerCase().split('.').last;
    return switch (ext) {
      'png' => MediaType('image', 'png'),
      'webp' => MediaType('image', 'webp'),
      _ => MediaType('image', 'jpeg'),
    };
  }

  /// Unwraps `{ success, data }` or throws a readable [ApiException].
  dynamic _decode(http.Response res) {
    dynamic body;
    try {
      body = res.body.isEmpty ? null : jsonDecode(res.body);
    } catch (_) {
      throw ApiException(
          'INVALID_RESPONSE', 'Unexpected server response.', res.statusCode);
    }
    if (res.statusCode >= 200 && res.statusCode < 300) {
      return (body is Map && body.containsKey('data')) ? body['data'] : body;
    }
    if (res.statusCode == 401) onUnauthorized?.call();
    if (body is Map) {
      throw ApiException(
        (body['error'] ?? 'ERROR').toString(),
        (body['message'] ?? 'Something went wrong. Please try again.')
            .toString(),
        res.statusCode,
        body['details'],
      );
    }
    throw ApiException('ERROR', 'Something went wrong.', res.statusCode);
  }

  Future<T> _guard<T>(Future<T> Function() run) async {
    try {
      return await run();
    } on SocketException {
      throw ApiException('NETWORK_ERROR',
          'Unable to reach the server. Check your connection.', 0);
    } on HttpException {
      throw ApiException('NETWORK_ERROR', 'Network error. Please try again.', 0);
    }
  }

  // ── Low-level verbs ────────────────────────────────────────
  Future<dynamic> _get(String path, [Map<String, dynamic>? q]) =>
      _guard(() async =>
          _decode(await http.get(_uri(path, q), headers: _headers())));

  Future<dynamic> _post(String path, [Object? body]) =>
      _guard(() async => _decode(await http.post(_uri(path),
          headers: _headers(), body: body == null ? null : jsonEncode(body))));

  Future<dynamic> _patch(String path, [Object? body]) =>
      _guard(() async => _decode(await http.patch(_uri(path),
          headers: _headers(), body: body == null ? null : jsonEncode(body))));

  Future<dynamic> _put(String path, [Object? body]) =>
      _guard(() async => _decode(await http.put(_uri(path),
          headers: _headers(), body: body == null ? null : jsonEncode(body))));

  Future<dynamic> _delete(String path) => _guard(
      () async => _decode(await http.delete(_uri(path), headers: _headers())));

  Future<Doctor> _uploadImage(String path, File file) => _guard(() async {
        final req = http.MultipartRequest('POST', _uri(path));
        if (tokens.token != null) {
          req.headers['Authorization'] = 'Bearer ${tokens.token}';
        }
        req.files.add(await http.MultipartFile.fromPath('file', file.path,
            contentType: _imageMediaType(file.path)));
        final res = await http.Response.fromStream(await req.send());
        return Doctor.fromJson(_decode(res) as Map<String, dynamic>);
      });

  // ── Auth ───────────────────────────────────────────────────
  Future<LoginResponse> login(String email, String password) async {
    final data = await _post('/auth/login', {'email': email, 'password': password});
    return LoginResponse.fromJson(data as Map<String, dynamic>);
  }

  Future<AuthUser> me() async =>
      AuthUser.fromJson(await _get('/auth/me') as Map<String, dynamic>);

  // ── Users ──────────────────────────────────────────────────
  Future<List<User>> listUsers() async =>
      (await _get('/users') as List).map((e) => User.fromJson(e)).toList();

  Future<User> createUser(Map<String, dynamic> body) async =>
      User.fromJson(await _post('/users', body) as Map<String, dynamic>);

  Future<User> updateUser(String id, Map<String, dynamic> body) async =>
      User.fromJson(await _patch('/users/$id', body) as Map<String, dynamic>);

  Future<void> removeUser(String id) => _delete('/users/$id');

  // ── Roles & permissions ────────────────────────────────────
  Future<List<Role>> listRoles() async =>
      (await _get('/roles') as List).map((e) => Role.fromJson(e)).toList();

  Future<List<Permission>> listPermissions() async =>
      (await _get('/permissions') as List)
          .map((e) => Permission.fromJson(e))
          .toList();

  Future<Role> createRole(Map<String, dynamic> body) async =>
      Role.fromJson(await _post('/roles', body) as Map<String, dynamic>);

  Future<Role> updateRole(String id, Map<String, dynamic> body) async =>
      Role.fromJson(await _patch('/roles/$id', body) as Map<String, dynamic>);

  Future<void> removeRole(String id) => _delete('/roles/$id');

  // ── Doctors ────────────────────────────────────────────────
  Future<List<Doctor>> listDoctors() async =>
      (await _get('/doctors') as List).map((e) => Doctor.fromJson(e)).toList();

  Future<Doctor> getDoctor(String id) async =>
      Doctor.fromJson(await _get('/doctors/$id') as Map<String, dynamic>);

  Future<Doctor> createDoctor(Map<String, dynamic> body) async =>
      Doctor.fromJson(await _post('/doctors', body) as Map<String, dynamic>);

  Future<Doctor> updateDoctor(String id, Map<String, dynamic> body) async =>
      Doctor.fromJson(await _patch('/doctors/$id', body) as Map<String, dynamic>);

  Future<Doctor> enableDoctor(String id) async =>
      Doctor.fromJson(await _patch('/doctors/$id/enable') as Map<String, dynamic>);

  Future<Doctor> disableDoctor(String id) async => Doctor.fromJson(
      await _patch('/doctors/$id/disable') as Map<String, dynamic>);

  Future<Doctor> uploadDoctorPhoto(String id, File file) =>
      _uploadImage('/doctors/$id/photo', file);

  Future<Doctor> uploadDoctorQr(String id, File file) =>
      _uploadImage('/doctors/$id/qr', file);

  // Doctor self-service
  Future<Doctor> getMe() async =>
      Doctor.fromJson(await _get('/doctors/me') as Map<String, dynamic>);

  Future<Doctor> updateMe(Map<String, dynamic> body) async =>
      Doctor.fromJson(await _patch('/doctors/me', body) as Map<String, dynamic>);

  Future<Doctor> uploadMyPhoto(File file) =>
      _uploadImage('/doctors/me/photo', file);

  Future<Doctor> uploadMyQr(File file) => _uploadImage('/doctors/me/qr', file);

  // ── Schedules & leave ──────────────────────────────────────
  Future<List<ScheduleEntry>> listSchedules(String doctorId) async =>
      (await _get('/doctors/$doctorId/schedules') as List)
          .map((e) => ScheduleEntry.fromJson(e))
          .toList();

  Future<void> replaceSchedules(
          String doctorId, List<ScheduleEntry> entries) =>
      _put('/doctors/$doctorId/schedules',
          {'entries': entries.map((e) => e.toJson()).toList()});

  Future<List<LeaveDay>> listLeave(String doctorId) async =>
      (await _get('/doctors/$doctorId/leave') as List)
          .map((e) => LeaveDay.fromJson(e))
          .toList();

  Future<void> markLeave(String doctorId, String date,
          [String? reason, bool force = false]) =>
      _post('/doctors/$doctorId/leave', {
        'date': date,
        if (reason != null && reason.isNotEmpty) 'reason': reason,
        if (force) 'force': true,
      });

  Future<void> removeLeave(String doctorId, String date) =>
      _delete('/doctors/$doctorId/leave/$date');

  Future<DaySlots> slots(String doctorId, String date) async => DaySlots.fromJson(
      await _get('/doctors/$doctorId/slots', {'date': date})
          as Map<String, dynamic>);

  // ── Appointments ───────────────────────────────────────────
  Future<List<Appointment>> listAppointments({
    String? doctorId,
    String? date,
    String? status,
    String? search,
    String? range, // today | upcoming | previous
  }) async {
    final q = <String, dynamic>{};
    if (doctorId != null) q['doctorId'] = doctorId;
    if (date != null) q['date'] = date;
    if (status != null) q['status'] = status;
    if (search != null && search.isNotEmpty) q['search'] = search;
    if (range != null) q['range'] = range;
    return (await _get('/appointments', q.isEmpty ? null : q) as List)
        .map((e) => Appointment.fromJson(e))
        .toList();
  }

  Future<Appointment> getAppointment(String id) async => Appointment.fromJson(
      await _get('/appointments/$id') as Map<String, dynamic>);

  /// Prior visits for a patient (matched by mobile), for the history view.
  Future<List<Appointment>> appointmentHistory(String mobile,
      {String? excludeId}) async {
    final q = <String, dynamic>{'mobile': mobile};
    if (excludeId != null) q['excludeId'] = excludeId;
    return (await _get('/appointments/history', q) as List)
        .map((e) => Appointment.fromJson(e))
        .toList();
  }

  Future<Appointment> bookWalkIn(Map<String, dynamic> body) async =>
      Appointment.fromJson(
          await _post('/appointments/walk-in', body) as Map<String, dynamic>);

  Future<Appointment> reschedule(
          String id, String date, String startTime) async =>
      Appointment.fromJson(await _patch('/appointments/$id/reschedule',
          {'appointment_date': date, 'start_time': startTime})
          as Map<String, dynamic>);

  Future<Appointment> addPrescriptions(String id, List<File> files) =>
      _guard(() async {
        final req = http.MultipartRequest('POST',
            _uri('/appointments/$id/prescriptions'));
        if (tokens.token != null) {
          req.headers['Authorization'] = 'Bearer ${tokens.token}';
        }
        for (final f in files) {
          req.files.add(await http.MultipartFile.fromPath('images', f.path,
              contentType: _imageMediaType(f.path)));
        }
        final res = await http.Response.fromStream(await req.send());
        return Appointment.fromJson(_decode(res) as Map<String, dynamic>);
      });

  Future<Appointment> deletePrescription(String id, String prescriptionId)
      async => Appointment.fromJson(
          await _delete('/appointments/$id/prescriptions/$prescriptionId')
              as Map<String, dynamic>);

  Future<Appointment> setConsultation(String id, String status) async =>
      Appointment.fromJson(await _patch('/appointments/$id/consultation',
          {'status': status}) as Map<String, dynamic>);

  Future<Appointment> setPayment(String id, String status) async =>
      Appointment.fromJson(await _patch('/appointments/$id/payment',
          {'status': status}) as Map<String, dynamic>);

  Future<Appointment> setNotes(String id, String notes) async =>
      Appointment.fromJson(await _patch('/appointments/$id/notes',
          {'notes': notes}) as Map<String, dynamic>);

  Future<Appointment> addReminder(String id, String message,
          [String? suggestedDate]) async =>
      Appointment.fromJson(await _post('/appointments/$id/reminder', {
        'message': message,
        if (suggestedDate != null && suggestedDate.isNotEmpty)
          'suggested_date': suggestedDate,
      }) as Map<String, dynamic>);

  // ── Dashboard ──────────────────────────────────────────────
  Future<DashboardSummary> dashboard() async => DashboardSummary.fromJson(
      await _get('/dashboard') as Map<String, dynamic>);

  // ── Pathlabs ───────────────────────────────────────────────
  Future<List<User>> listPathlabs() async =>
      (await _get('/pathlabs') as List).map((e) => User.fromJson(e)).toList();

  Future<User> createPathlab(Map<String, dynamic> body) async =>
      User.fromJson(await _post('/pathlabs', body) as Map<String, dynamic>);

  Future<User> updatePathlab(String id, Map<String, dynamic> body) async =>
      User.fromJson(await _patch('/pathlabs/$id', body) as Map<String, dynamic>);

  Future<void> removePathlab(String id) => _delete('/pathlabs/$id');

  // ── Reports ────────────────────────────────────────────────
  Future<List<PatientReport>> listReports(String mobile) async =>
      (await _get('/reports', {'mobile': mobile}) as List)
          .map((e) => PatientReport.fromJson(e))
          .toList();

  Future<void> uploadReport(String mobile, String title, File file) =>
      _guard(() async {
        final req = http.MultipartRequest('POST', _uri('/reports'));
        if (tokens.token != null) {
          req.headers['Authorization'] = 'Bearer ${tokens.token}';
        }
        req.fields['mobile'] = mobile;
        req.fields['title'] = title;
        req.files.add(await http.MultipartFile.fromPath('file', file.path,
            contentType: _imageMediaType(file.path)));
        final res = await http.Response.fromStream(await req.send());
        _decode(res);
      });

  Future<void> removeReport(String id) => _delete('/reports/$id');
}
