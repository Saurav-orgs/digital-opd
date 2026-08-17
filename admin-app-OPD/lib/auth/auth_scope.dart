import 'package:flutter/widgets.dart';
import '../api/api_client.dart';
import '../api/models.dart';

/// Holds the authenticated session and exposes RBAC checks, mirroring the
/// admin web `AuthContext`. Re-hydrates from a stored token on launch and
/// drops the session on any 401.
class AuthController extends ChangeNotifier {
  final ApiClient api;
  AuthUser? user;
  bool loading = true;

  AuthController(this.api) {
    api.onUnauthorized = _onUnauthorized;
  }

  bool get isAuthenticated => user != null;

  /// Load the token, then validate it by fetching the current user.
  Future<void> bootstrap() async {
    await api.tokens.load();
    if (api.tokens.token == null) {
      loading = false;
      notifyListeners();
      return;
    }
    try {
      user = await api.me();
    } catch (_) {
      await api.tokens.clear();
      user = null;
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  Future<void> login(String email, String password) async {
    final res = await api.login(email, password);
    await api.tokens.set(res.accessToken);
    user = res.user;
    notifyListeners();
  }

  Future<void> logout() async {
    await api.tokens.clear();
    user = null;
    notifyListeners();
  }

  /// RBAC gate: super admins can do everything; others need `module:action`.
  bool can(String module, String action) =>
      user?.can(module, action) ?? false;

  void _onUnauthorized() {
    // Token rejected mid-session — clear and return to login.
    if (user != null) {
      user = null;
      api.tokens.clear();
      notifyListeners();
    }
  }
}

/// Makes the [AuthController] available to the widget tree and rebuilds
/// listeners when the session changes.
class AuthScope extends InheritedNotifier<AuthController> {
  const AuthScope({
    super.key,
    required AuthController controller,
    required super.child,
  }) : super(notifier: controller);

  static AuthController of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<AuthScope>();
    assert(scope != null, 'AuthScope not found in context');
    return scope!.notifier!;
  }
}
