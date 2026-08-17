import 'dart:io' show Platform;
import 'package:flutter_dotenv/flutter_dotenv.dart';

/// API base URL for the OPD backend.
///
/// Resolved in order of precedence:
///   1. `--dart-define=API_BASE_URL=...` (compile-time override).
///   2. `API_BASE_URL` from the bundled `.env` file — edit `.env` to change it.
///   3. Per-platform default (local dev):
///        - iOS simulator & desktop: `localhost` reaches the host machine.
///        - Android emulator: `10.0.2.2` is the host loopback alias.
class AppConfig {
  static const String _override =
      String.fromEnvironment('API_BASE_URL', defaultValue: '');

  static String get apiBaseUrl {
    if (_override.isNotEmpty) return _override;
    final fromEnv = dotenv.maybeGet('API_BASE_URL')?.trim() ?? '';
    if (fromEnv.isNotEmpty) return fromEnv;
    final host =
        (!Platform.isIOS && Platform.isAndroid) ? '10.0.2.2' : 'localhost';
    // return 'http://$host:3000/api';
    return 'https://76ml0vk8-3000.inc1.devtunnels.ms/api';
  }

  /// Patients may book from today up to +7 days (matches backend).
  static const int bookingWindowDays = 7;

  /// Max screenshot size in MB (matches backend guard).
  static const int maxUploadMb = 5;
}
