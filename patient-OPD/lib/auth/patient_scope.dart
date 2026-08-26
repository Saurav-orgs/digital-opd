import 'package:flutter/widgets.dart';
import '../api/api_client.dart';
import '../api/models.dart';

/// Holds the phone-only session, mirroring the admin app's `AuthController`.
///
/// The session is an *account* (a number), not a person. Which of the account's
/// patients is being viewed is held here too: there is no default patient, so a
/// number with several people on it must be asked — except when it has exactly
/// one, which is selected automatically.
class PatientAuthController extends ChangeNotifier {
  final ApiClient api;
  AuthPatient? patient;
  List<PatientProfile> profiles = const [];
  String? selectedProfileId;
  bool loading = true;

  PatientAuthController(this.api);

  bool get isAuthenticated => patient != null;

  PatientProfile? get selected {
    for (final p in profiles) {
      if (p.id == selectedProfileId) return p;
    }
    return null;
  }

  void selectProfile(String id) {
    selectedProfileId = id;
    notifyListeners();
  }

  void _applyProfiles(List<PatientProfile> list) {
    profiles = list;
    final stillThere = list.any((p) => p.id == selectedProfileId);
    if (!stillThere) {
      selectedProfileId = list.length == 1 ? list.first.id : null;
    }
  }

  Future<void> refreshProfiles() async {
    _applyProfiles(await api.patientProfiles());
    notifyListeners();
  }

  Future<void> bootstrap() async {
    await api.tokens.load();
    if (api.tokens.token == null) {
      loading = false;
      notifyListeners();
      return;
    }
    try {
      final me = await api.patientMe();
      patient = me.patient;
      _applyProfiles(me.patients);
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
    _applyProfiles(session.patients);
    notifyListeners();
  }

  /// Registering creates exactly one patient from the details given.
  Future<void> register(String mobile, PatientDetails details,
      {String? doctorId}) async {
    final session =
        await api.registerPatient(mobile, details, doctorId: doctorId);
    await api.tokens.set(session.accessToken);
    patient = session.patient;
    _applyProfiles(session.patients);
    // Exactly one patient was just created — view them.
    if (session.patients.length == 1) {
      selectedProfileId = session.patients.first.id;
    }
    notifyListeners();
  }

  Future<void> logout() async {
    await api.tokens.clear();
    patient = null;
    profiles = const [];
    selectedProfileId = null;
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
