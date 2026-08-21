import 'package:flutter/material.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'api/api_client.dart';
import 'auth/patient_scope.dart';
import 'doctor_context.dart';
import 'theme.dart';
import 'screens/home_shell.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Load runtime config (API base URL). Optional so a missing .env falls back
  // to AppConfig's per-platform defaults instead of crashing at startup.
  try {
    await dotenv.load(fileName: '.env');
  } catch (_) {
    // No .env bundled — AppConfig will use its built-in defaults.
  }
  runApp(const OpdApp());
}

class OpdApp extends StatefulWidget {
  const OpdApp({super.key});

  @override
  State<OpdApp> createState() => _OpdAppState();
}

class _OpdAppState extends State<OpdApp> {
  late final PatientAuthController _auth;
  late final DoctorContextController _doctorCtx;

  @override
  void initState() {
    super.initState();
    _doctorCtx = DoctorContextController();
    _doctorCtx.load();
    _auth = PatientAuthController(ApiClient());
    _auth.bootstrap();
  }

  @override
  Widget build(BuildContext context) {
    return DoctorContextScope(
      controller: _doctorCtx,
      child: PatientAuthScope(
        controller: _auth,
        child: MaterialApp(
          title: 'OPD Appointments',
          debugShowCheckedModeBanner: false,
          theme: buildTheme(),
          home: const HomeShell(),
        ),
      ),
    );
  }
}
