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

  bool get isSuperAdmin => type == 'super_admin';

  /// True only for doctor-type accounts (not super admin, not staff).
  bool get isDoctor => doctorId != null && type == 'doctor';

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

/// Returned once by POST /doctors — show credentials immediately, they are not
/// stored server-side.
class CreateDoctorResult {
  final Doctor doctor;
  final String doctorRoleName;
  final String pathlabRoleName;
  final String loginEmail;
  final String tempPassword;
  final String qrUrl;

  CreateDoctorResult({
    required this.doctor,
    required this.doctorRoleName,
    required this.pathlabRoleName,
    required this.loginEmail,
    required this.tempPassword,
    required this.qrUrl,
  });

  factory CreateDoctorResult.fromJson(Map<String, dynamic> j) =>
      CreateDoctorResult(
        doctor: Doctor.fromJson(j['doctor'] as Map<String, dynamic>),
        doctorRoleName:
            (j['doctorRole'] as Map?)?.cast<String, dynamic>()['name'] as String? ?? '',
        pathlabRoleName:
            (j['pathlabRole'] as Map?)?.cast<String, dynamic>()['name'] as String? ?? '',
        loginEmail:
            (j['login'] as Map?)?.cast<String, dynamic>()['email'] as String? ?? '',
        tempPassword:
            (j['login'] as Map?)?.cast<String, dynamic>()['tempPassword'] as String? ?? '',
        qrUrl: j['qrUrl'] as String? ?? '',
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
  final String publicSlug;
  final bool isEnabled;
  final String? profileBaseUrl;
  final String? bookingUrl;
  final String? qrCodeUrl;
  // Prescription letterhead (per-doctor branding)
  final String? clinicName;
  final String? clinicAddress;
  final String? clinicPhone;
  final String? clinicLogoUrl;

  Doctor({
    required this.id,
    required this.name,
    this.specialization,
    this.qualifications,
    this.bio,
    this.consultationFee,
    this.profilePhotoUrl,
    required this.publicSlug,
    required this.isEnabled,
    this.profileBaseUrl,
    this.bookingUrl,
    this.qrCodeUrl,
    this.clinicName,
    this.clinicAddress,
    this.clinicPhone,
    this.clinicLogoUrl,
  });

  factory Doctor.fromJson(Map<String, dynamic> j) => Doctor(
        id: j['id'] as String,
        name: j['name'] as String? ?? '',
        specialization: j['specialization'] as String?,
        qualifications: j['qualifications'] as String?,
        bio: j['bio'] as String?,
        consultationFee: _str(j['consultation_fee']),
        profilePhotoUrl: j['profile_photo_url'] as String?,
        publicSlug: j['public_slug'] as String? ?? '',
        isEnabled: j['is_enabled'] as bool? ?? false,
        profileBaseUrl: j['profile_base_url'] as String?,
        bookingUrl: j['booking_url'] as String?,
        qrCodeUrl: j['qr_code_url'] as String?,
        clinicName: j['clinic_name'] as String?,
        clinicAddress: j['clinic_address'] as String?,
        clinicPhone: j['clinic_phone'] as String?,
        clinicLogoUrl: j['clinic_logo_url'] as String?,
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

/// One person registered on a mobile number. Identity is [id], never the name.
class PatientProfile {
  final String id;
  final String patientCode;
  final String name;
  final String? relation;
  final String? gender;
  final String? addressLine;
  final String? city;
  final String? state;
  final String? pincode;
  final int? lastAge;
  final String? lastVisitDate;
  final int visitCount;
  final bool canDelete;

  PatientProfile({
    required this.id,
    required this.patientCode,
    required this.name,
    this.relation,
    this.gender,
    this.addressLine,
    this.city,
    this.state,
    this.pincode,
    this.lastAge,
    this.lastVisitDate,
    this.visitCount = 0,
    this.canDelete = true,
  });

  factory PatientProfile.fromJson(Map<String, dynamic> j) => PatientProfile(
        id: j['id'] as String,
        patientCode: (j['patient_code'] ?? '') as String,
        name: (j['name'] ?? '') as String,
        relation: j['relation'] as String?,
        gender: j['gender'] as String?,
        addressLine: j['address_line'] as String?,
        city: j['city'] as String?,
        state: j['state'] as String?,
        pincode: j['pincode'] as String?,
        lastAge: (j['last_age'] as num?)?.toInt(),
        lastVisitDate: j['last_visit_date'] as String?,
        visitCount: (j['visit_count'] as num?)?.toInt() ?? 0,
        canDelete: (j['can_delete'] ?? true) as bool,
      );

  String get subtitle => [
        if (lastAge != null) '$lastAge yrs',
        if (gender != null && gender!.isNotEmpty) gender,
        patientCode,
      ].join(' · ');
}

/// One measurement's movement between the previous visit and this one.
class ProgressTrend {
  final String label;
  final String previousValue;
  final String currentValue;
  final String direction; // up | down | same
  final String interpretation; // better | worse | unclear

  ProgressTrend({
    required this.label,
    required this.previousValue,
    required this.currentValue,
    required this.direction,
    required this.interpretation,
  });

  factory ProgressTrend.fromJson(Map<String, dynamic> j) => ProgressTrend(
        label: (j['label'] ?? '') as String,
        previousValue: (j['previous_value'] ?? '') as String,
        currentValue: (j['current_value'] ?? '') as String,
        direction: (j['direction'] ?? 'same') as String,
        interpretation: (j['interpretation'] ?? 'unclear') as String,
      );
}

/// What changed since the patient's last visit, and where they stand now.
class ProgressSummary {
  final String status; // improving | stable | worsening | unclear
  final String summary;
  final List<String> improvements;
  final List<String> deteriorations;
  final List<String> unchanged;
  final List<ProgressTrend> trends;
  final String currentStatus;
  final List<String> watchPoints;

  ProgressSummary({
    required this.status,
    required this.summary,
    this.improvements = const [],
    this.deteriorations = const [],
    this.unchanged = const [],
    this.trends = const [],
    this.currentStatus = '',
    this.watchPoints = const [],
  });

  static List<String> _strings(dynamic v) =>
      ((v as List?) ?? []).map((e) => e.toString()).toList();

  factory ProgressSummary.fromJson(Map<String, dynamic> j) => ProgressSummary(
        status: (j['status'] ?? 'unclear') as String,
        summary: (j['summary'] ?? '') as String,
        improvements: _strings(j['improvements']),
        deteriorations: _strings(j['deteriorations']),
        unchanged: _strings(j['unchanged']),
        trends: ((j['trends'] as List?) ?? [])
            .map((t) => ProgressTrend.fromJson(t as Map<String, dynamic>))
            .toList(),
        currentStatus: (j['current_status'] ?? '') as String,
        watchPoints: _strings(j['watch_points']),
      );
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
  final String? source; // app | web | walk_in
  final bool onLeave; // day was later marked as leave — reschedule needed
  final bool acceptsReports; // patient may still upload reports to this visit
  final ReportAiSummary? reportsSummary; // combined across all visit reports
  final String? reportsSummaryStatus; // pending|processing|ready|failed|null
  final String? reportsSummaryError;
  final int reportsSummaryCount;

  // ── The across-visits picture ──
  // Null status means there was no earlier visit to compare against, and the
  // UI falls back to the per-visit combined summary.
  final ProgressSummary? progressSummary;
  final String? progressSummaryStatus;
  final String? progressSummaryError;
  final int progressSummaryVisitCount;

  final String? patientCity;
  final String? patientState;
  final String? patientPincode;

  /// Which person on the number this visit is for — the clinical identity.
  final String? patientProfileId;
  final PatientProfile? patientProfile;
  final DoctorRef? doctor;
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
    this.source,
    this.onLeave = false,
    this.acceptsReports = false,
    this.reportsSummary,
    this.reportsSummaryStatus,
    this.reportsSummaryError,
    this.reportsSummaryCount = 0,
    this.progressSummary,
    this.progressSummaryStatus,
    this.progressSummaryError,
    this.progressSummaryVisitCount = 0,
    this.patientCity,
    this.patientState,
    this.patientPincode,
    this.patientProfileId,
    this.patientProfile,
    this.doctor,
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
        source: j['source'] as String?,
        onLeave: j['on_leave'] as bool? ?? false,
        acceptsReports: j['accepts_reports'] as bool? ?? false,
        reportsSummary: j['reports_summary'] == null
            ? null
            : ReportAiSummary.fromJson(
                j['reports_summary'] as Map<String, dynamic>),
        reportsSummaryStatus: j['reports_summary_status'] as String?,
        reportsSummaryError: j['reports_summary_error'] as String?,
        reportsSummaryCount: (j['reports_summary_count'] as num?)?.toInt() ?? 0,
        progressSummary: j['progress_summary'] == null
            ? null
            : ProgressSummary.fromJson(
                j['progress_summary'] as Map<String, dynamic>),
        progressSummaryStatus: j['progress_summary_status'] as String?,
        progressSummaryError: j['progress_summary_error'] as String?,
        progressSummaryVisitCount:
            (j['progress_summary_visit_count'] as num?)?.toInt() ?? 0,
        patientCity: j['patient_city'] as String?,
        patientState: j['patient_state'] as String?,
        patientPincode: j['patient_pincode'] as String?,
        patientProfileId: j['patient_profile_id'] as String?,
        patientProfile: j['patientProfile'] == null
            ? null
            : PatientProfile.fromJson(
                j['patientProfile'] as Map<String, dynamic>),
        doctor: j['doctor'] == null
            ? null
            : DoctorRef.fromJson(j['doctor'] as Map<String, dynamic>),
        prescriptions: ((j['prescriptions'] as List?) ?? [])
            .map((p) => PrescriptionImage.fromJson(p as Map<String, dynamic>))
            .toList(),
        reports: ((j['reports'] as List?) ?? [])
            .map((r) => PatientReport.fromJson(r as Map<String, dynamic>))
            .toList(),
      );
}

/// Structured AI summary of an uploaded report.
class ReportAiSummary {
  final String reportType;
  final String summary;
  final List<String> keyFindings;
  final List<AbnormalValue> abnormalValues;

  ReportAiSummary({
    this.reportType = '',
    this.summary = '',
    this.keyFindings = const [],
    this.abnormalValues = const [],
  });

  factory ReportAiSummary.fromJson(Map<String, dynamic> j) => ReportAiSummary(
        reportType: j['report_type'] as String? ?? '',
        summary: j['summary'] as String? ?? '',
        keyFindings:
            ((j['key_findings'] as List?) ?? []).map((e) => '$e').toList(),
        abnormalValues: ((j['abnormal_values'] as List?) ?? [])
            .map((v) => AbnormalValue.fromJson(v as Map<String, dynamic>))
            .toList(),
      );
}

class AbnormalValue {
  final String label;
  final String value;
  final String reference;
  final String direction; // high | low | abnormal

  AbnormalValue({
    required this.label,
    required this.value,
    this.reference = '',
    this.direction = 'abnormal',
  });

  factory AbnormalValue.fromJson(Map<String, dynamic> j) => AbnormalValue(
        label: j['label'] as String? ?? '',
        value: j['value'] as String? ?? '',
        reference: j['reference'] as String? ?? '',
        direction: j['direction'] as String? ?? 'abnormal',
      );
}

/// Recording → transcript → draft. Polled while it runs.
class ConsultationSession {
  final String id;
  final String status; // transcribing | drafting | draft_ready | failed
  final String? transcript;
  final int? durationSeconds;
  final String? error;

  ConsultationSession({
    required this.id,
    required this.status,
    this.transcript,
    this.durationSeconds,
    this.error,
  });

  factory ConsultationSession.fromJson(Map<String, dynamic> j) =>
      ConsultationSession(
        id: j['id'] as String,
        status: j['status'] as String? ?? 'transcribing',
        transcript: j['transcript'] as String?,
        durationSeconds: (j['duration_seconds'] as num?)?.toInt(),
        error: j['error'] as String?,
      );

  bool get inProgress => status == 'transcribing' || status == 'drafting';
}

class PrescriptionMedicine {
  String? id;
  String medicineName;
  String? strength;
  String? form;
  String dosage;
  int? durationDays;
  String? instructions;
  final String source; // ai | doctor

  PrescriptionMedicine({
    this.id,
    this.medicineName = '',
    this.strength,
    this.form,
    this.dosage = '',
    this.durationDays,
    this.instructions,
    this.source = 'doctor',
  });

  factory PrescriptionMedicine.fromJson(Map<String, dynamic> j) =>
      PrescriptionMedicine(
        id: j['id'] as String?,
        medicineName: j['medicine_name'] as String? ?? '',
        strength: j['strength'] as String?,
        form: j['form'] as String?,
        dosage: j['dosage'] as String? ?? '',
        durationDays: (j['duration_days'] as num?)?.toInt(),
        instructions: j['instructions'] as String?,
        source: j['source'] as String? ?? 'doctor',
      );

  Map<String, dynamic> toJson() => {
        if (id != null) 'id': id,
        'medicine_name': medicineName.trim(),
        if (strength != null && strength!.isNotEmpty) 'strength': strength,
        if (form != null && form!.isNotEmpty) 'form': form,
        if (dosage.isNotEmpty) 'dosage': dosage.trim(),
        if (durationDays != null) 'duration_days': durationDays,
        if (instructions != null && instructions!.isNotEmpty)
          'instructions': instructions,
      };

  bool get fromAi => source == 'ai';
}

class EPrescription {
  final String id;
  final String status; // draft | issued
  final String mode; // structured | handwritten
  final String? diagnosis;
  final String? advice;
  final String? followUpDate;
  final String? pdfUrl;
  final String? handwritingImageUrl;
  final List<PrescriptionMedicine> medicines;

  EPrescription({
    required this.id,
    required this.status,
    this.mode = 'structured',
    this.diagnosis,
    this.advice,
    this.followUpDate,
    this.pdfUrl,
    this.handwritingImageUrl,
    this.medicines = const [],
  });

  factory EPrescription.fromJson(Map<String, dynamic> j) => EPrescription(
        id: j['id'] as String,
        status: j['status'] as String? ?? 'draft',
        mode: j['mode'] as String? ?? 'structured',
        diagnosis: j['diagnosis'] as String?,
        advice: j['advice'] as String?,
        followUpDate: j['follow_up_date'] as String?,
        pdfUrl: j['pdf_url'] as String?,
        handwritingImageUrl: j['handwriting_image_url'] as String?,
        medicines: ((j['medicines'] as List?) ?? [])
            .map((m) => PrescriptionMedicine.fromJson(m as Map<String, dynamic>))
            .toList(),
      );

  bool get isIssued => status == 'issued';
  bool get isHandwritten => mode == 'handwritten';
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

  /// AI summary, generated in the background after upload. `summaryStatus` is
  /// pending | processing | ready | failed, so the UI can distinguish "queued",
  /// "working on it" and "it didn't work" rather than showing a silent gap.
  final ReportAiSummary? aiSummary;
  final String summaryStatus;
  final String? summaryError;

  PatientReport({
    required this.id,
    required this.title,
    this.url,
    required this.createdAt,
    this.aiSummary,
    this.summaryStatus = 'pending',
    this.summaryError,
  });

  factory PatientReport.fromJson(Map<String, dynamic> j) => PatientReport(
        id: j['id'] as String,
        title: j['title'] as String? ?? '',
        url: j['url'] as String?,
        createdAt: j['createdAt'] as String? ?? '',
        aiSummary: j['ai_summary'] == null
            ? null
            : ReportAiSummary.fromJson(j['ai_summary'] as Map<String, dynamic>),
        summaryStatus: j['ai_summary_status'] as String? ?? 'pending',
        summaryError: j['ai_summary_error'] as String?,
      );
}
