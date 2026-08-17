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

  @override
  String toString() => message;
}

/// Persists the patient's JWT across launches (SharedPreferences) with an
/// in-memory cache — mirrors the admin app's TokenStore.
class PatientTokenStore {
  static const _key = 'opd_patient_token';
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
  final PatientTokenStore tokens = PatientTokenStore();

  Map<String, String> _authHeaders({bool json = true}) => {
        if (json) 'Content-Type': 'application/json',
        'Accept': 'application/json',
        if (tokens.token != null) 'Authorization': 'Bearer ${tokens.token}',
      };

  /// Infer the image mime from the file extension so the backend's mime
  /// allowlist (jpeg/png/webp) accepts the multipart part.
  MediaType _imageMediaType(String path) {
    final ext = path.toLowerCase().split('.').last;
    return switch (ext) {
      'png' => MediaType('image', 'png'),
      'webp' => MediaType('image', 'webp'),
      _ => MediaType('image', 'jpeg'),
    };
  }

  /// Reports may also be PDFs, on top of the image allowlist.
  MediaType _documentMediaType(String path) {
    final ext = path.toLowerCase().split('.').last;
    if (ext == 'pdf') return MediaType('application', 'pdf');
    return _imageMediaType(path);
  }

  Uri _uri(String path, [Map<String, dynamic>? query]) =>
      Uri.parse('$base$path').replace(
        queryParameters: query?.map((k, v) => MapEntry(k, '$v')),
      );

  /// Unwraps `{ success, data }` or throws a readable [ApiException].
  dynamic _decode(http.Response res) {
    dynamic body;
    try {
      body = jsonDecode(res.body);
    } catch (_) {
      throw ApiException('INVALID_RESPONSE', 'Unexpected server response.',
          res.statusCode);
    }
    if (res.statusCode >= 200 && res.statusCode < 300) {
      return (body is Map && body.containsKey('data')) ? body['data'] : body;
    }
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

  // ── Endpoints (public, no auth) ────────────────────────────
  Future<List<Doctor>> listDoctors() => _guard(() async {
        final res = await http.get(_uri('/public/doctors'));
        final data = _decode(res) as List;
        return data
            .map((d) => Doctor.fromJson(d as Map<String, dynamic>))
            .toList();
      });

  Future<Doctor> doctorBySlug(String slug) => _guard(() async {
        final res = await http.get(_uri('/public/doctors/$slug'));
        return Doctor.fromJson(_decode(res) as Map<String, dynamic>);
      });

  Future<DaySlots> slots(String doctorId, String date) => _guard(() async {
        final res =
            await http.get(_uri('/public/doctors/$doctorId/slots', {'date': date}));
        return DaySlots.fromJson(_decode(res) as Map<String, dynamic>);
      });

  Future<BookingResult> book({
    required String doctorId,
    required String date,
    required String startTime,
    required String patientName,
    required String patientMobile,
    required String patientGender,
    required int patientAge,
    String? patientAddress,
    String? description,
    required File screenshot,
  }) =>
      _guard(() async {
        final req = http.MultipartRequest(
          'POST',
          _uri('/public/appointments'),
        );
        req.fields.addAll({
          'doctor_id': doctorId,
          'appointment_date': date,
          'start_time': startTime,
          'patient_name': patientName,
          'patient_mobile': patientMobile,
          'patient_gender': patientGender,
          'patient_age': '$patientAge',
          if (patientAddress != null && patientAddress.isNotEmpty)
            'patient_address': patientAddress,
          if (description != null && description.isNotEmpty)
            'description': description,
        });
        req.files.add(await http.MultipartFile.fromPath(
          'screenshot',
          screenshot.path,
          contentType: _imageMediaType(screenshot.path),
        ));
        final streamed = await req.send();
        final res = await http.Response.fromStream(streamed);
        return BookingResult.fromJson(_decode(res) as Map<String, dynamic>);
      });

  // ── Patient auth (phone-only, no OTP) ───────────────────────
  Future<PatientSession> registerPatient(String mobile, String name) =>
      _guard(() async {
        final res = await http.post(_uri('/patient/auth/register'),
            headers: _authHeaders(),
            body: jsonEncode({'mobile': mobile, 'name': name}));
        return PatientSession.fromJson(_decode(res) as Map<String, dynamic>);
      });

  Future<PatientSession> loginPatient(String mobile) => _guard(() async {
        final res = await http.post(_uri('/patient/auth/login'),
            headers: _authHeaders(), body: jsonEncode({'mobile': mobile}));
        return PatientSession.fromJson(_decode(res) as Map<String, dynamic>);
      });

  Future<AuthPatient> patientMe() => _guard(() async {
        final res = await http.get(_uri('/patient/auth/me'), headers: _authHeaders());
        return AuthPatient.fromJson(_decode(res) as Map<String, dynamic>);
      });

  // ── Patient portal ───────────────────────────────────────────
  Future<List<PatientVisit>> myVisits() => _guard(() async {
        final res = await http.get(_uri('/patient/appointments'), headers: _authHeaders());
        return (_decode(res) as List)
            .map((v) => PatientVisit.fromJson(v as Map<String, dynamic>))
            .toList();
      });

  Future<List<PatientReport>> myReports() => _guard(() async {
        final res = await http.get(_uri('/patient/reports'), headers: _authHeaders());
        return (_decode(res) as List)
            .map((r) => PatientReport.fromJson(r as Map<String, dynamic>))
            .toList();
      });

  /// Patient self-upload — attaches to their most recently booked appointment.
  Future<void> uploadMyReport(String title, File file) => _guard(() async {
        final req = http.MultipartRequest('POST', _uri('/patient/reports'));
        if (tokens.token != null) {
          req.headers['Authorization'] = 'Bearer ${tokens.token}';
        }
        req.fields['title'] = title;
        req.files.add(await http.MultipartFile.fromPath('file', file.path,
            contentType: _documentMediaType(file.path)));
        final res = await http.Response.fromStream(await req.send());
        _decode(res);
      });

  Future<List<PatientNotification>> notifications() => _guard(() async {
        final res = await http.get(_uri('/patient/notifications'), headers: _authHeaders());
        return (_decode(res) as List)
            .map((n) => PatientNotification.fromJson(n as Map<String, dynamic>))
            .toList();
      });

  Future<int> unreadCount() => _guard(() async {
        final res = await http.get(
            _uri('/patient/notifications/unread-count'),
            headers: _authHeaders());
        return (_decode(res) as Map<String, dynamic>)['count'] as int;
      });

  Future<void> markNotificationRead(String id) => _guard(() async {
        await http.patch(_uri('/patient/notifications/$id/read'), headers: _authHeaders());
      });

  Future<void> markAllNotificationsRead() => _guard(() async {
        await http.patch(_uri('/patient/notifications/read-all'), headers: _authHeaders());
      });
}
