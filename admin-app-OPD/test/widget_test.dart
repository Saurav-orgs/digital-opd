// Basic smoke test for the OPD Admin app.
//
// The app requires a live backend + stored session to render its shells, so
// this test just verifies the login screen renders when unauthenticated.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:opd_admin/screens/login_screen.dart';
import 'package:opd_admin/theme.dart';

void main() {
  testWidgets('Login screen renders its title', (tester) async {
    await tester.pumpWidget(
      MaterialApp(theme: buildTheme(), home: const LoginScreen()),
    );
    expect(find.text('OPD Admin'), findsOneWidget);
    expect(find.text('Sign in'), findsWidgets);
  });
}
