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

class AuthPatient {
  final String id;
  final String mobile;
  final String name;

  AuthPatient({required this.id, required this.mobile, required this.name});

  factory AuthPatient.fromJson(Map<String, dynamic> j) => AuthPatient(
        id: j['id'] as String,
        mobile: j['mobile'] as String,
        name: j['name'] as String,
      );
}

class PatientSession {
  final String accessToken;
  final AuthPatient patient;

  PatientSession({required this.accessToken, required this.patient});

  factory PatientSession.fromJson(Map<String, dynamic> j) => PatientSession(
        accessToken: j['accessToken'] as String,
        patient: AuthPatient.fromJson(j['patient'] as Map<String, dynamic>),
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
