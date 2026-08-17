import 'package:flutter/material.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'api/api_client.dart';
import 'auth/auth_scope.dart';
import 'screens/home_shell.dart';
import 'screens/login_screen.dart';
import 'theme.dart';
import 'widgets/common.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Load runtime config (API base URL). Optional so a missing .env falls back
  // to AppConfig's per-platform defaults instead of crashing at startup.
  try {
    await dotenv.load(fileName: '.env');
  } catch (_) {
    // No .env bundled — AppConfig will use its built-in defaults.
  }

  final controller = AuthController(ApiClient(TokenStore()));
  await controller.bootstrap();

  runApp(OpdAdminApp(controller: controller));
}

class OpdAdminApp extends StatelessWidget {
  final AuthController controller;
  const OpdAdminApp({super.key, required this.controller});

  @override
  Widget build(BuildContext context) {
    return AuthScope(
      controller: controller,
      child: MaterialApp(
        title: 'OPD Admin',
        debugShowCheckedModeBanner: false,
        theme: buildTheme(),
        home: const _Root(),
      ),
    );
  }
}

/// Swaps between login and the app shell as the session changes.
class _Root extends StatelessWidget {
  const _Root();

  @override
  Widget build(BuildContext context) {
    final auth = AuthScope.of(context); // rebuilds on auth changes
    if (auth.loading) {
      return const Scaffold(body: StateView(loading: true));
    }
    return auth.isAuthenticated ? const HomeShell() : const LoginScreen();
  }
}
