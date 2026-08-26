class Doctor {
  final String id;
  final String name;
  final String? specialization;
  final String? qualifications;
  final String? bio;
  final String? consultationFee;
  final String? profilePhotoUrl;
  final String publicSlug;

  Doctor({
    required this.id,
    required this.name,
    this.specialization,
    this.qualifications,
    this.bio,
    this.consultationFee,
    this.profilePhotoUrl,
    required this.publicSlug,
  });

  factory Doctor.fromJson(Map<String, dynamic> j) => Doctor(
        id: j['id'] as String,
        name: j['name'] as String,
        specialization: j['specialization'] as String?,
        qualifications: j['qualifications'] as String?,
        bio: j['bio'] as String?,
        consultationFee: j['consultation_fee']?.toString(),
        profilePhotoUrl: j['profile_photo_url'] as String?,
        publicSlug: j['public_slug'] as String? ?? '',
      );

  String get feeLabel =>
      consultationFee == null ? '' : '₹$consultationFee';
}

enum SlotStatus { available, booked, past }

class Slot {
  final String startTime; // HH:mm
  final String endTime; // HH:mm
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

  bool get selectable => status == SlotStatus.available;
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
        date: j['date'] as String,
        available: j['available'] as bool? ?? false,
        reason: j['reason'] as String?,
        slots: ((j['slots'] as List?) ?? [])
            .map((s) => Slot.fromJson(s as Map<String, dynamic>))
            .toList(),
      );

  String get unavailableLabel => switch (reason) {
        'leave' => 'The doctor is on leave this day.',
        'no_opd' => 'No OPD hours on this day.',
        'out_of_window' => 'Bookings open only for the next 7 days.',
        _ => 'Not available.',
      };
}

/// The logged-in *account* — a mobile number, not a person. The people on it
/// are [PatientProfile]s.
class AuthPatient {
  final String id;
  final String mobile;

  AuthPatient({required this.id, required this.mobile});

  factory AuthPatient.fromJson(Map<String, dynamic> j) => AuthPatient(
        id: j['id'] as String,
        mobile: j['mobile'] as String,
      );
}

/// One person registered on a number.
///
/// Identity is [id], never [name]: two profiles on the same account may share a
/// name and are still different patients. Nothing is matched by name at
/// runtime — the patient picks a profile, or gets a new one.
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

  /// False once an OPD has been completed — the record is permanent then.
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
        lastAge: j['last_age'] as int?,
        lastVisitDate: j['last_visit_date'] as String?,
        visitCount: (j['visit_count'] ?? 0) as int,
        canDelete: (j['can_delete'] ?? true) as bool,
      );

  /// "34 yrs · male · PT-7K3M9Q" — what the pick-list shows under the name.
  String get subtitle => [
        if (lastAge != null) '$lastAge yrs',
        if (gender != null && gender!.isNotEmpty) gender,
        patientCode,
      ].join(' · ');
}

/// The details captured when registering a patient, on any path.
class PatientDetails {
  final String name;
  final String? gender;
  final int? age;
  final String? relation;
  final String addressLine;
  final String city;
  final String state;
  final String pincode;

  PatientDetails({
    required this.name,
    this.gender,
    this.age,
    this.relation,
    required this.addressLine,
    required this.city,
    required this.state,
    required this.pincode,
  });

  Map<String, dynamic> toJson() => {
        'name': name,
        if (gender != null && gender!.isNotEmpty) 'gender': gender,
        if (age != null) 'age': age,
        if (relation != null && relation!.isNotEmpty) 'relation': relation,
        'address_line': addressLine,
        'city': city,
        'state': state,
        'pincode': pincode,
      };
}

class PatientSession {
  final String accessToken;
  final AuthPatient patient;
  final List<PatientProfile> patients;

  PatientSession({
    required this.accessToken,
    required this.patient,
    this.patients = const [],
  });

  factory PatientSession.fromJson(Map<String, dynamic> j) => PatientSession(
        accessToken: j['accessToken'] as String,
        patient: AuthPatient.fromJson(j['patient'] as Map<String, dynamic>),
        patients: ((j['patients'] ?? []) as List)
            .map((p) => PatientProfile.fromJson(p as Map<String, dynamic>))
            .toList(),
      );
}

/// What booking step 1 returns for a number.
class IdentifyResult {
  final String accessToken;
  final String mobile;
  final List<PatientProfile> patients;

  IdentifyResult({
    required this.accessToken,
    required this.mobile,
    required this.patients,
  });

  factory IdentifyResult.fromJson(Map<String, dynamic> j) => IdentifyResult(
        accessToken: j['accessToken'] as String,
        mobile: (j['mobile'] ?? '') as String,
        patients: ((j['patients'] ?? []) as List)
            .map((p) => PatientProfile.fromJson(p as Map<String, dynamic>))
            .toList(),
      );
}

class RxImage {
  final String id;
  final String? url;
  RxImage({required this.id, this.url});
  factory RxImage.fromJson(Map<String, dynamic> j) =>
      RxImage(id: j['id'] as String, url: j['url'] as String?);
}

class IssuedMedicine {
  final String id;
  final String medicineName;
  final String? strength;
  final String? form;
  final String dosage;
  final String? timing;
  final int? durationDays;
  final String? instructions;

  IssuedMedicine({
    required this.id,
    required this.medicineName,
    this.strength,
    this.form,
    required this.dosage,
    this.timing,
    this.durationDays,
    this.instructions,
  });

  factory IssuedMedicine.fromJson(Map<String, dynamic> j) => IssuedMedicine(
        id: j['id'] as String,
        medicineName: j['medicine_name'] as String? ?? '',
        strength: j['strength'] as String?,
        form: j['form'] as String?,
        dosage: j['dosage'] as String? ?? '',
        timing: j['timing'] as String?,
        durationDays: (j['duration_days'] as num?)?.toInt(),
        instructions: j['instructions'] as String?,
      );

  /// "1-0-1 · after food · 5 days" — the line a patient actually reads.
  String get scheduleLabel => [
        dosage,
        if (timing != null && timing!.isNotEmpty) timing,
        if (durationDays != null) '$durationDays days',
      ].where((p) => p != null && p.isNotEmpty).join(' · ');
}

/// Only present once the doctor issues it — drafts never reach the patient.
class IssuedPrescription {
  final String id;
  final String? diagnosis;
  final String? advice;
  final String? followUpDate;
  final String? issuedAt;
  final String? pdfUrl;
  final List<IssuedMedicine> medicines;

  IssuedPrescription({
    required this.id,
    this.diagnosis,
    this.advice,
    this.followUpDate,
    this.issuedAt,
    this.pdfUrl,
    this.medicines = const [],
  });

  factory IssuedPrescription.fromJson(Map<String, dynamic> j) =>
      IssuedPrescription(
        id: j['id'] as String,
        diagnosis: j['diagnosis'] as String?,
        advice: j['advice'] as String?,
        followUpDate: j['follow_up_date'] as String?,
        issuedAt: j['issued_at'] as String?,
        pdfUrl: j['pdf_url'] as String?,
        medicines: ((j['medicines'] as List?) ?? [])
            .map((m) => IssuedMedicine.fromJson(m as Map<String, dynamic>))
            .toList(),
      );
}

/// One consultation visit — the patient's booking history.
class PatientVisit {
  final String id;
  final String appointmentDate;
  final String startTime;
  final String status;
  final String consultationStatus;
  final bool acceptsReports;
  final String? description;
  final String? doctorNotes;
  final String? nextVisitNote;
  final String? nextVisitDate;
  final String? doctorName;
  final String? doctorSpecialization;
  final List<RxImage> prescriptions;
  final List<PatientReport> reports;
  final IssuedPrescription? ePrescription;

  PatientVisit({
    required this.id,
    required this.appointmentDate,
    required this.startTime,
    required this.status,
    required this.consultationStatus,
    this.acceptsReports = false,
    this.description,
    this.doctorNotes,
    this.nextVisitNote,
    this.nextVisitDate,
    this.doctorName,
    this.doctorSpecialization,
    required this.prescriptions,
    this.reports = const [],
    this.ePrescription,
  });

  factory PatientVisit.fromJson(Map<String, dynamic> j) {
    final doctor = j['doctor'] as Map<String, dynamic>?;
    return PatientVisit(
      id: j['id'] as String,
      appointmentDate: j['appointment_date'] as String,
      startTime: (j['start_time'] as String).substring(0, 5),
      status: j['status'] as String,
      consultationStatus: j['consultation_status'] as String,
      acceptsReports: j['accepts_reports'] as bool? ?? false,
      description: j['description'] as String?,
      doctorNotes: j['doctor_notes'] as String?,
      nextVisitNote: j['next_visit_note'] as String?,
      nextVisitDate: j['next_visit_date'] as String?,
      doctorName: doctor?['name'] as String?,
      doctorSpecialization: doctor?['specialization'] as String?,
      prescriptions: ((j['prescriptions'] as List?) ?? [])
          .map((p) => RxImage.fromJson(p as Map<String, dynamic>))
          .toList(),
      reports: ((j['reports'] as List?) ?? [])
          .map((r) => PatientReport.fromJson(r as Map<String, dynamic>))
          .toList(),
      ePrescription: j['e_prescription'] == null
          ? null
          : IssuedPrescription.fromJson(
              j['e_prescription'] as Map<String, dynamic>),
    );
  }
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
        title: j['title'] as String,
        url: j['url'] as String?,
        createdAt: j['createdAt'] as String,
      );
}

class PatientNotification {
  final String id;
  final String type;
  final String title;
  final String? body;
  final String? readAt;
  final String createdAt;

  PatientNotification({
    required this.id,
    required this.type,
    required this.title,
    this.body,
    this.readAt,
    required this.createdAt,
  });

  bool get isUnread => readAt == null;

  factory PatientNotification.fromJson(Map<String, dynamic> j) =>
      PatientNotification(
        id: j['id'] as String,
        type: j['type'] as String,
        title: j['title'] as String,
        body: j['body'] as String?,
        readAt: j['read_at'] as String?,
        createdAt: j['createdAt'] as String,
      );
}

class BookingResult {
  final String id;
  final String appointmentDate;
  final String startTime;
  final String endTime;
  final String patientName;
  final String? doctorName;

  BookingResult({
    required this.id,
    required this.appointmentDate,
    required this.startTime,
    required this.endTime,
    required this.patientName,
    this.doctorName,
  });

  factory BookingResult.fromJson(Map<String, dynamic> j) => BookingResult(
        id: j['id'] as String,
        appointmentDate: j['appointment_date'] as String,
        startTime: (j['start_time'] as String).substring(0, 5),
        endTime: (j['end_time'] as String).substring(0, 5),
        patientName: j['patient_name'] as String,
        doctorName: (j['doctor'] as Map<String, dynamic>?)?['name'] as String?,
      );
}
