import 'package:flutter/material.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:opd_admin/api/api_client.dart';
import 'package:opd_admin/api/models.dart';
import 'package:opd_admin/auth/auth_scope.dart';
import 'package:opd_admin/screens/appointments_screen.dart';

/// Records the `search` value passed to each appointments query.
class _FakeApi extends ApiClient {
  _FakeApi() : super(TokenStore());
  final List<String?> searchCalls = [];

  @override
  Future<List<Appointment>> listAppointments({
    String? doctorId,
    String? date,
    String? status,
    String? search,
    String? range,
  }) async {
    searchCalls.add(search);
    return [];
  }

  @override
  Future<List<Doctor>> listDoctors() async => [];
}

void main() {
  setUpAll(() => dotenv.testLoad(fileInput: 'API_BASE_URL=http://localhost/api'));

  testWidgets('typing searches, clearing returns to all', (tester) async {
    final api = _FakeApi();
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
          child: const Scaffold(body: AppointmentsScreen()),
        ),
      ),
    );
    await tester.pump(); // initial load
    expect(api.searchCalls, [null], reason: 'initial load has no search');

    await tester.enterText(find.byType(TextField), 'John');
    await tester.pump(const Duration(milliseconds: 400)); // past debounce
    expect(api.searchCalls.last, 'John', reason: 'typing sends the query');

    await tester.enterText(find.byType(TextField), '');
    await tester.pump(const Duration(milliseconds: 400));
    expect(api.searchCalls.last, isNull,
        reason: 'clearing text returns to all');
  });
}
