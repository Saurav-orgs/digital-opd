import 'package:flutter/widgets.dart';
import '../api/api_client.dart';
import '../api/models.dart';

/// Holds the patient's phone-only session, mirroring the admin app's
/// `AuthController`. Re-hydrates from a stored token on launch.
class PatientAuthController extends ChangeNotifier {
  final ApiClient api;
  AuthPatient? patient;
  bool loading = true;

  PatientAuthController(this.api);

  bool get isAuthenticated => patient != null;

  Future<void> bootstrap() async {
    await api.tokens.load();
    if (api.tokens.token == null) {
      loading = false;
      notifyListeners();
      return;
    }
    try {
      patient = await api.patientMe();
    } catch (_) {
      await api.tokens.clear();
      patient = null;
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  Future<void> login(String mobile, {String? doctorId}) async {
    final session = await api.loginPatient(mobile, doctorId: doctorId);
    await api.tokens.set(session.accessToken);
    patient = session.patient;
    notifyListeners();
  }

  Future<void> register(String mobile, String name, {String? doctorId}) async {
    final session = await api.registerPatient(mobile, name, doctorId: doctorId);
    await api.tokens.set(session.accessToken);
    patient = session.patient;
    notifyListeners();
  }

  Future<void> logout() async {
    await api.tokens.clear();
    patient = null;
    notifyListeners();
  }
}

class PatientAuthScope extends InheritedNotifier<PatientAuthController> {
  const PatientAuthScope({
    super.key,
    required PatientAuthController controller,
    required super.child,
  }) : super(notifier: controller);

  static PatientAuthController of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<PatientAuthScope>();
    assert(scope != null, 'PatientAuthScope not found in context');
    return scope!.notifier!;
  }
}
