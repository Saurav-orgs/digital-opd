// Data models mirroring the backend response envelope (admin web `types.ts`).

String? _str(dynamic v) => v?.toString();

class AuthUser {
  final String id;
  final String email;
  final String name;
  final String type; // super_admin | admin | doctor
  final String? roleId;
  final String? doctorId;
  final List<String> permissions; // "module:action"

  AuthUser({
    required this.id,
    required this.email,
    required this.name,
    required this.type,
    this.roleId,
    this.doctorId,
    required this.permissions,
  });

  factory AuthUser.fromJson(Map<String, dynamic> j) => AuthUser(
        id: j['id'] as String,
        email: j['email'] as String? ?? '',
        name: j['name'] as String? ?? '',
        type: j['type'] as String? ?? 'admin',
        roleId: j['roleId'] as String?,
        doctorId: j['doctorId'] as String?,
        permissions:
            ((j['permissions'] as List?) ?? []).map((e) => '$e').toList(),
      );

  bool get isDoctor => type == 'doctor';
  bool get isSuperAdmin => type == 'super_admin';

  /// RBAC check mirroring the web `can(module, action)`.
  bool can(String module, String action) {
    if (isSuperAdmin) return true;
    return permissions.contains('$module:$action');
  }
}

class LoginResponse {
  final String accessToken;
  final AuthUser user;
  LoginResponse({required this.accessToken, required this.user});

  factory LoginResponse.fromJson(Map<String, dynamic> j) => LoginResponse(
        accessToken: j['accessToken'] as String,
        user: AuthUser.fromJson(j['user'] as Map<String, dynamic>),
      );
}

class Permission {
  final String id;
  final String module;
  final String action;
  Permission({required this.id, required this.module, required this.action});

  factory Permission.fromJson(Map<String, dynamic> j) => Permission(
        id: j['id'] as String,
        module: j['module'] as String,
        action: j['action'] as String,
      );
}

class Role {
  final String id;
  final String name;
  final String? description;
  final bool isSystem;
  final List<Permission> permissions;

  Role({
    required this.id,
    required this.name,
    this.description,
    required this.isSystem,
    required this.permissions,
  });

  factory Role.fromJson(Map<String, dynamic> j) => Role(
        id: j['id'] as String,
        name: j['name'] as String? ?? '',
        description: j['description'] as String?,
        isSystem: j['is_system'] as bool? ?? false,
        permissions: ((j['permissions'] as List?) ?? [])
            .map((p) => Permission.fromJson(p as Map<String, dynamic>))
            .toList(),
      );
}

class Doctor {
  final String id;
  final String name;
  final String? specialization;
  final String? qualifications;
  final String? bio;
  final String? consultationFee;
  final String? profilePhotoUrl;
  final String? paymentQrUrl;
  final String publicSlug;
  final bool isEnabled;

  Doctor({
    required this.id,
    required this.name,
    this.specialization,
    this.qualifications,
    this.bio,
    this.consultationFee,
    this.profilePhotoUrl,
    this.paymentQrUrl,
    required this.publicSlug,
    required this.isEnabled,
  });

  factory Doctor.fromJson(Map<String, dynamic> j) => Doctor(
        id: j['id'] as String,
        name: j['name'] as String? ?? '',
        specialization: j['specialization'] as String?,
        qualifications: j['qualifications'] as String?,
        bio: j['bio'] as String?,
        consultationFee: _str(j['consultation_fee']),
        profilePhotoUrl: j['profile_photo_url'] as String?,
        paymentQrUrl: j['payment_qr_url'] as String?,
        publicSlug: j['public_slug'] as String? ?? '',
        isEnabled: j['is_enabled'] as bool? ?? false,
      );

  String get feeLabel => consultationFee == null ? '—' : '₹$consultationFee';
}

class User {
  final String id;
  final String name;
  final String email;
  final String type;
  final String? roleId;
  final String? doctorId;
  final bool isActive;
  final Role? role;
  final Doctor? doctor;

  User({
    required this.id,
    required this.name,
    required this.email,
    required this.type,
    this.roleId,
    this.doctorId,
    required this.isActive,
    this.role,
    this.doctor,
  });

  factory User.fromJson(Map<String, dynamic> j) => User(
        id: j['id'] as String,
        name: j['name'] as String? ?? '',
        email: j['email'] as String? ?? '',
        type: j['type'] as String? ?? 'admin',
        roleId: j['role_id'] as String?,
        doctorId: j['doctor_id'] as String?,
        isActive: j['is_active'] as bool? ?? true,
        role: j['role'] == null
            ? null
            : Role.fromJson(j['role'] as Map<String, dynamic>),
        doctor: j['doctor'] == null
            ? null
            : Doctor.fromJson(j['doctor'] as Map<String, dynamic>),
      );
}

class ScheduleEntry {
  final String? id;
  final int dayOfWeek;
  final String startTime; // HH:mm
  final String endTime; // HH:mm
  final int slotDurationMin;

  ScheduleEntry({
    this.id,
    required this.dayOfWeek,
    required this.startTime,
    required this.endTime,
    required this.slotDurationMin,
  });

  static String _hhmm(String t) => t.length >= 5 ? t.substring(0, 5) : t;

  factory ScheduleEntry.fromJson(Map<String, dynamic> j) => ScheduleEntry(
        id: j['id'] as String?,
        dayOfWeek: (j['day_of_week'] as num).toInt(),
        startTime: _hhmm(j['start_time'] as String),
        endTime: _hhmm(j['end_time'] as String),
        slotDurationMin: (j['slot_duration_min'] as num).toInt(),
      );

  Map<String, dynamic> toJson() => {
        'day_of_week': dayOfWeek,
        'start_time': startTime,
        'end_time': endTime,
        'slot_duration_min': slotDurationMin,
      };
}

enum SlotStatus { available, booked, past }

class Slot {
  final String startTime;
  final String endTime;
  final SlotStatus status;
  Slot({required this.startTime, required this.endTime, required this.status});

  factory Slot.fromJson(Map<String, dynamic> j) => Slot(
        startTime: j['start_time'] as String,
        endTime: j['end_time'] as String,
        status: switch (j['status']) {
          'booked' => SlotStatus.booked,
          'past' => SlotStatus.past,
          _ => SlotStatus.available,
        },
      );
}

class DaySlots {
  final String date;
  final bool available;
  final String? reason; // leave | no_opd | out_of_window
  final List<Slot> slots;

  DaySlots({
    required this.date,
    required this.available,
    this.reason,
    required this.slots,
  });

  factory DaySlots.fromJson(Map<String, dynamic> j) => DaySlots(
        date: j['date'] as String? ?? '',
        available: j['available'] as bool? ?? false,
        reason: j['reason'] as String?,
        slots: ((j['slots'] as List?) ?? [])
            .map((s) => Slot.fromJson(s as Map<String, dynamic>))
            .toList(),
      );

  String get unavailableLabel => switch (reason) {
        'leave' => 'On leave this day.',
        'no_opd' => 'No OPD hours on this day.',
        'out_of_window' => 'Outside the booking window.',
        _ => 'Not available.',
      };
}

class LeaveDay {
  final String id;
  final String date;
  final String? reason;
  LeaveDay({required this.id, required this.date, this.reason});

  factory LeaveDay.fromJson(Map<String, dynamic> j) => LeaveDay(
        id: j['id'] as String,
        date: j['date'] as String,
        reason: j['reason'] as String?,
      );
}

class DoctorRef {
  final String id;
  final String name;
  final String? specialization;
  final String? consultationFee;
  DoctorRef({
    required this.id,
    required this.name,
    this.specialization,
    this.consultationFee,
  });

  factory DoctorRef.fromJson(Map<String, dynamic> j) => DoctorRef(
        id: j['id'] as String,
        name: j['name'] as String? ?? '',
        specialization: j['specialization'] as String?,
        consultationFee: _str(j['consultation_fee']),
      );
}

class PrescriptionImage {
  final String id;
  final String? url; // presigned GET url
  PrescriptionImage({required this.id, this.url});

  factory PrescriptionImage.fromJson(Map<String, dynamic> j) =>
      PrescriptionImage(id: j['id'] as String, url: j['url'] as String?);
}

class Appointment {
  final String id;
  final String doctorId;
  final String appointmentDate;
  final String startTime;
  final String endTime;
  final String patientName;
  final String patientMobile;
  final String? patientGender;
  final int? patientAge;
  final String? patientAddress;
  final String? description;
  final String? doctorNotes;
  final String? nextVisitNote;
  final String? nextVisitDate;
  final String status; // confirmed | rejected
  final String consultationStatus; // pending | done | on_hold | rejected
  final String paymentStatus; // paid_unverified | verified | rejected
  final String? paymentMethod; // online | cod
  final String? source; // app | web | walk_in
  final bool onLeave; // day was later marked as leave — reschedule needed
  final DoctorRef? doctor;
  final String? screenshotUrl; // presigned, only on detail
  final List<PrescriptionImage> prescriptions;
  final List<PatientReport> reports;

  Appointment({
    required this.id,
    required this.doctorId,
    required this.appointmentDate,
    required this.startTime,
    required this.endTime,
    required this.patientName,
    required this.patientMobile,
    this.patientGender,
    this.patientAge,
    this.patientAddress,
    this.description,
    this.doctorNotes,
    this.nextVisitNote,
    this.nextVisitDate,
    required this.status,
    required this.consultationStatus,
    required this.paymentStatus,
    this.paymentMethod,
    this.source,
    this.onLeave = false,
    this.doctor,
    this.screenshotUrl,
    this.prescriptions = const [],
    this.reports = const [],
  });

  static String _hhmm(String? t) =>
      (t != null && t.length >= 5) ? t.substring(0, 5) : (t ?? '');

  bool get isWalkIn => source == 'walk_in';

  factory Appointment.fromJson(Map<String, dynamic> j) => Appointment(
        id: j['id'] as String,
        doctorId: j['doctor_id'] as String? ?? '',
        appointmentDate: j['appointment_date'] as String? ?? '',
        startTime: _hhmm(j['start_time'] as String?),
        endTime: _hhmm(j['end_time'] as String?),
        patientName: j['patient_name'] as String? ?? '',
        patientMobile: j['patient_mobile'] as String? ?? '',
        patientGender: j['patient_gender'] as String?,
        patientAge: (j['patient_age'] as num?)?.toInt(),
        patientAddress: j['patient_address'] as String?,
        description: j['description'] as String?,
        doctorNotes: j['doctor_notes'] as String?,
        nextVisitNote: j['next_visit_note'] as String?,
        nextVisitDate: j['next_visit_date'] as String?,
        status: j['status'] as String? ?? 'confirmed',
        consultationStatus: j['consultation_status'] as String? ?? 'pending',
        paymentStatus: j['payment_status'] as String? ?? 'paid_unverified',
        paymentMethod: j['payment_method'] as String?,
        source: j['source'] as String?,
        onLeave: j['on_leave'] as bool? ?? false,
        doctor: j['doctor'] == null
            ? null
            : DoctorRef.fromJson(j['doctor'] as Map<String, dynamic>),
        screenshotUrl: j['screenshot_url'] as String?,
        prescriptions: ((j['prescriptions'] as List?) ?? [])
            .map((p) => PrescriptionImage.fromJson(p as Map<String, dynamic>))
            .toList(),
        reports: ((j['reports'] as List?) ?? [])
            .map((r) => PatientReport.fromJson(r as Map<String, dynamic>))
            .toList(),
      );
}

class DoctorCount {
  final String doctorId;
  final String name;
  final int count;
  DoctorCount({required this.doctorId, required this.name, required this.count});

  factory DoctorCount.fromJson(Map<String, dynamic> j) => DoctorCount(
        doctorId: j['doctorId'] as String? ?? '',
        name: j['name'] as String? ?? '',
        count: (j['count'] as num?)?.toInt() ?? 0,
      );
}

class DashboardSummary {
  final String date;
  final int total;
  final int upcoming;
  final int previous;
  final int pendingToday;
  final int pendingUpcoming;
  final int pendingPrevious;
  final List<DoctorCount> byDoctor;
  final Map<String, int> byStatus;
  final List<Appointment> appointments;

  DashboardSummary({
    required this.date,
    required this.total,
    required this.upcoming,
    required this.previous,
    required this.pendingToday,
    required this.pendingUpcoming,
    required this.pendingPrevious,
    required this.byDoctor,
    required this.byStatus,
    required this.appointments,
  });

  factory DashboardSummary.fromJson(Map<String, dynamic> j) {
    final pending = (j['pending'] as Map?) ?? {};
    return DashboardSummary(
        date: j['date'] as String? ?? '',
        total: (j['total'] as num?)?.toInt() ?? 0,
        upcoming: (j['upcoming'] as num?)?.toInt() ?? 0,
        previous: (j['previous'] as num?)?.toInt() ?? 0,
        pendingToday: (pending['today'] as num?)?.toInt() ?? 0,
        pendingUpcoming: (pending['upcoming'] as num?)?.toInt() ?? 0,
        pendingPrevious: (pending['previous'] as num?)?.toInt() ?? 0,
        byDoctor: ((j['byDoctor'] as List?) ?? [])
            .map((d) => DoctorCount.fromJson(d as Map<String, dynamic>))
            .toList(),
        byStatus: ((j['byStatus'] as Map?) ?? {}).map(
          (k, v) => MapEntry('$k', (v as num?)?.toInt() ?? 0),
        ),
        appointments: ((j['appointments'] as List?) ?? [])
            .map((a) => Appointment.fromJson(a as Map<String, dynamic>))
            .toList(),
      );
  }

  int status(String key) => byStatus[key] ?? 0;
}

class PatientReport {
  final String id;
  final String title;
  final String? url;
  final String createdAt;
  PatientReport({
    required this.id,
    required this.title,
    this.url,
    required this.createdAt,
  });

  factory PatientReport.fromJson(Map<String, dynamic> j) => PatientReport(
        id: j['id'] as String,
        title: j['title'] as String? ?? '',
        url: j['url'] as String?,
        createdAt: j['createdAt'] as String? ?? '',
      );
}
