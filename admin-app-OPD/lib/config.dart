import 'package:flutter_dotenv/flutter_dotenv.dart';

/// API base URL for the OPD backend.
///
/// Resolved in order of precedence:
///   1. `--dart-define=API_BASE_URL=...` (compile-time override).
///   2. `API_BASE_URL` from the bundled `.env` file — edit `.env` to change it.
class AppConfig {
  static const String _override =
      String.fromEnvironment('API_BASE_URL', defaultValue: '');

  static String get apiBaseUrl {
    if (_override.isNotEmpty) return _override;
    final fromEnv = dotenv.maybeGet('API_BASE_URL')?.trim() ?? '';
    if (fromEnv.isNotEmpty) return fromEnv;
    return 'https://76ml0vk8-3000.inc1.devtunnels.ms/api';
  }

  /// Base URL of the patient web app — used to build QR/booking links.
  static String get patientWebBase {
    final fromEnv = dotenv.maybeGet('PATIENT_WEB_BASE')?.trim() ?? '';
    if (fromEnv.isNotEmpty) return fromEnv;
    return 'http://localhost:5174';
  }
}
