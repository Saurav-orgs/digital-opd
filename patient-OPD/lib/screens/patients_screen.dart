import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../api/api_client.dart';
import '../api/models.dart';
import '../auth/patient_scope.dart';
import '../theme.dart';
import '../widgets/common.dart';

/// Everyone registered on this mobile number — switch between them, add one,
/// or remove one added by mistake.
///
/// Deleting is the only way to undo a duplicate, because nothing in this system
/// merges patient records. It stays available exactly until an OPD is
/// completed; after that the record carries real clinical history and the
/// button is disabled with the reason shown.
class PatientsScreen extends StatefulWidget {
  const PatientsScreen({super.key});

  @override
  State<PatientsScreen> createState() => _PatientsScreenState();
}

class _PatientsScreenState extends State<PatientsScreen> {
  bool _busy = false;

  Future<void> _delete(PatientProfile p) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Delete ${p.name}?'),
        content: const Text(
          'Their bookings will be cancelled and any reports removed. This '
          'cannot be undone.',
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Keep')),
          TextButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Delete')),
        ],
      ),
    );
    if (ok != true || !mounted) return;

    setState(() => _busy = true);
    final auth = PatientAuthScope.of(context);
    try {
      await auth.api.deletePatientProfile(p.id);
      await auth.refreshProfiles();
    } on ApiException catch (e) {
      if (mounted) showErrorSnack(context, e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _add() async {
    final details = await Navigator.push<PatientDetails>(
      context,
      MaterialPageRoute(builder: (_) => const _AddPatientScreen()),
    );
    if (details == null || !mounted) return;

    setState(() => _busy = true);
    final auth = PatientAuthScope.of(context);
    try {
      final created = await auth.api.addPatientProfile(details);
      await auth.refreshProfiles();
      if (mounted) auth.selectProfile(created.id);
    } on ApiException catch (e) {
      if (mounted) showErrorSnack(context, e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = PatientAuthScope.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Patients')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text(
            'Each person has their own visits, reports and summaries. Two '
            'people may share a name — they are still separate records.',
            style: TextStyle(color: AppColors.textSecondary),
          ),
          const SizedBox(height: 14),
          for (final p in auth.profiles)
            Card(
              margin: const EdgeInsets.only(bottom: 10),
              child: ListTile(
                title: Row(
                  children: [
                    Flexible(
                      child: Text(p.name,
                          style: const TextStyle(fontWeight: FontWeight.w600)),
                    ),
                    if (p.id == auth.selectedProfileId) ...[
                      const SizedBox(width: 8),
                      const Icon(Icons.check_circle,
                          size: 15, color: AppColors.primary),
                    ],
                  ],
                ),
                subtitle: Text(
                  '${p.subtitle}\n'
                  '${p.visitCount == 0 ? 'No visits yet' : '${p.visitCount} visit(s)'}'
                  '${p.lastVisitDate != null ? ' · last ${p.lastVisitDate}' : ''}',
                ),
                isThreeLine: true,
                onTap: () => auth.selectProfile(p.id),
                trailing: IconButton(
                  icon: const Icon(Icons.delete_outline),
                  color: p.canDelete ? AppColors.error : AppColors.textSecondary,
                  tooltip: p.canDelete
                      ? 'Delete this patient'
                      : 'This patient has a completed OPD and can no longer be '
                          'deleted.',
                  onPressed: (!p.canDelete || _busy) ? null : () => _delete(p),
                ),
              ),
            ),
          const SizedBox(height: 8),
          FilledButton.icon(
            onPressed: _busy ? null : _add,
            icon: const Icon(Icons.person_add_alt),
            label: const Text('Add a patient'),
          ),
        ],
      ),
    );
  }
}

/// Collects one patient's details — the same set every other path collects,
/// since registering anywhere creates exactly one patient.
class _AddPatientScreen extends StatefulWidget {
  const _AddPatientScreen();

  @override
  State<_AddPatientScreen> createState() => _AddPatientScreenState();
}

class _AddPatientScreenState extends State<_AddPatientScreen> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _age = TextEditingController();
  final _address = TextEditingController();
  final _city = TextEditingController();
  final _state = TextEditingController();
  final _pincode = TextEditingController();
  String? _gender;
  String? _relation;

  @override
  void dispose() {
    _name.dispose();
    _age.dispose();
    _address.dispose();
    _city.dispose();
    _state.dispose();
    _pincode.dispose();
    super.dispose();
  }

  void _save() {
    if (!_formKey.currentState!.validate()) return;
    Navigator.pop(
      context,
      PatientDetails(
        name: _name.text.trim(),
        gender: _gender,
        age: int.tryParse(_age.text.trim()),
        relation: _relation,
        addressLine: _address.text.trim(),
        city: _city.text.trim(),
        state: _state.text.trim(),
        pincode: _pincode.text.trim(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Add a patient')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _field(_name, 'Full name *', validator: (v) {
              if ((v ?? '').trim().length < 2) {
                return 'Please enter the patient’s name.';
              }
              return null;
            }),
            _dropdown(
              label: 'Gender',
              value: _gender,
              options: const {'male': 'Male', 'female': 'Female', 'other': 'Other'},
              onChanged: (v) => setState(() => _gender = v),
            ),
            _dropdown(
              label: 'Relation',
              value: _relation,
              options: const {
                'self': 'Self',
                'spouse': 'Spouse',
                'child': 'Child',
                'parent': 'Parent',
                'other': 'Other',
              },
              onChanged: (v) => setState(() => _relation = v),
            ),
            _field(_age, 'Age',
                keyboard: TextInputType.number,
                inputFormatters: [
                  FilteringTextInputFormatter.digitsOnly,
                  LengthLimitingTextInputFormatter(3),
                ]),
            _field(_address, 'Address *', maxLines: 2, validator: (v) {
              if ((v ?? '').trim().length < 3) return 'Please enter the address.';
              return null;
            }),
            _field(_city, 'City *', validator: (v) {
              if ((v ?? '').trim().length < 2) return 'Please enter the city.';
              return null;
            }),
            _field(_state, 'State *', validator: (v) {
              if ((v ?? '').trim().length < 2) return 'Please enter the state.';
              return null;
            }),
            _field(_pincode, 'PIN code *',
                keyboard: TextInputType.number,
                inputFormatters: [
                  FilteringTextInputFormatter.digitsOnly,
                  LengthLimitingTextInputFormatter(6),
                ], validator: (v) {
              if (!RegExp(r'^[1-9]\d{5}$').hasMatch((v ?? '').trim())) {
                return 'Enter a valid 6-digit PIN code.';
              }
              return null;
            }),
            const SizedBox(height: 16),
            SizedBox(
              height: 50,
              child: ElevatedButton(
                onPressed: _save,
                child: const Text('Add patient'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _dropdown({
    required String label,
    required String? value,
    required Map<String, String> options,
    required ValueChanged<String?> onChanged,
  }) =>
      Padding(
        padding: const EdgeInsets.only(bottom: 14),
        child: DropdownButtonFormField<String>(
          initialValue: value,
          decoration: InputDecoration(labelText: label),
          items: [
            for (final e in options.entries)
              DropdownMenuItem(value: e.key, child: Text(e.value)),
          ],
          onChanged: onChanged,
        ),
      );

  Widget _field(
    TextEditingController c,
    String label, {
    TextInputType? keyboard,
    int maxLines = 1,
    List<TextInputFormatter>? inputFormatters,
    String? Function(String?)? validator,
  }) =>
      Padding(
        padding: const EdgeInsets.only(bottom: 14),
        child: TextFormField(
          controller: c,
          keyboardType: keyboard,
          maxLines: maxLines,
          inputFormatters: inputFormatters,
          validator: validator,
          decoration: InputDecoration(labelText: label),
        ),
      );
}
