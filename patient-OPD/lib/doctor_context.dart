import 'dart:convert';
import 'package:flutter/widgets.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _kKey = 'opd_doctor_ctx';

class DoctorCtxData {
  final String id;
  final String slug;
  final String name;
  final String? specialization;

  const DoctorCtxData({
    required this.id,
    required this.slug,
    required this.name,
    this.specialization,
  });

  factory DoctorCtxData.fromJson(Map<String, dynamic> j) => DoctorCtxData(
        id: j['id'] as String,
        slug: j['slug'] as String,
        name: j['name'] as String,
        specialization: j['specialization'] as String?,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'slug': slug,
        'name': name,
        if (specialization != null) 'specialization': specialization,
      };
}

/// Persists the current doctor context in SharedPreferences and notifies
/// listeners when it changes. Mirrors the web `DoctorContext`.
class DoctorContextController extends ChangeNotifier {
  DoctorCtxData? _doctor;

  DoctorCtxData? get doctor => _doctor;

  Future<void> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_kKey);
      if (raw != null) {
        _doctor = DoctorCtxData.fromJson(
            jsonDecode(raw) as Map<String, dynamic>);
        notifyListeners();
      }
    } catch (_) {}
  }

  Future<void> setDoctor(DoctorCtxData d) async {
    _doctor = d;
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kKey, jsonEncode(d.toJson()));
  }

  Future<void> clear() async {
    _doctor = null;
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_kKey);
  }
}

class DoctorContextScope extends InheritedNotifier<DoctorContextController> {
  const DoctorContextScope({
    super.key,
    required DoctorContextController controller,
    required super.child,
  }) : super(notifier: controller);

  static DoctorContextController of(BuildContext context) {
    final scope =
        context.dependOnInheritedWidgetOfExactType<DoctorContextScope>();
    assert(scope != null, 'DoctorContextScope not found in context');
    return scope!.notifier!;
  }
}
