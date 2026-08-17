import 'package:flutter/material.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:opd_admin/api/api_client.dart';
import 'package:opd_admin/api/models.dart';
import 'package:opd_admin/auth/auth_scope.dart';
import 'package:opd_admin/screens/appointments_screen.dart';

Appointment _appt({String? notes}) => Appointment.fromJson({
      'id': 'appt1',
      'doctor_id': 'd1',
      'appointment_date': '2026-07-28',
      'start_time': '11:00:00',
      'end_time': '11:10:00',
      'patient_name': 'John Doe',
      'patient_mobile': '9876543210',
      'status': 'confirmed',
      'consultation_status': 'pending',
      'payment_status': 'paid_unverified',
      'doctor_notes': notes,
    });

class _FakeApi extends ApiClient {
  _FakeApi() : super(TokenStore());
  String? current;
  String? savedNotes;

  @override
  Future<Appointment> getAppointment(String id) async => _appt(notes: current);

  @override
  Future<List<Appointment>> appointmentHistory(String mobile,
          {String? excludeId}) async =>
      [];

  @override
  Future<Appointment> setNotes(String id, String notes) async {
    savedNotes = notes;
    current = notes;
    return _appt(notes: notes);
  }
}

void main() {
  setUpAll(() => dotenv.testLoad(fileInput: 'API_BASE_URL=http://localhost/api'));

  testWidgets('note editor seeds from appointment and saves edits',
      (tester) async {
    final api = _FakeApi()..current = 'old note';
    final auth = AuthController(api)
      ..user = AuthUser(
        id: '1',
        email: 'a@b.c',
        name: 'Admin',
        type: 'super_admin',
        permissions: const [],
      )
      ..loading = false;

    await tester.pumpWidget(
      MaterialApp(
        home: AuthScope(
          controller: auth,
          child: const AppointmentDetailScreen(id: 'appt1'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // Editor is seeded with the existing note.
    expect(find.text('old note'), findsOneWidget);

    // Edit and save.
    await tester.enterText(find.byType(TextField), 'follow up in 2 weeks');
    await tester.tap(find.text('Save note'));
    await tester.pumpAndSettle();

    expect(api.savedNotes, 'follow up in 2 weeks',
        reason: 'Save sends the trimmed note text');
  });
}
