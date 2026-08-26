import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../api/api_client.dart';
import '../api/models.dart';
import '../auth/auth_scope.dart';
import '../theme.dart';
import '../widgets/common.dart';
import '../widgets/slot_selector.dart';

/// Doctor books an in-clinic walk-in. Payment is collected in person.
/// Returns `true` on success so the caller can refresh.
class WalkInFormScreen extends StatefulWidget {
  const WalkInFormScreen({super.key});

  @override
  State<WalkInFormScreen> createState() => _WalkInFormScreenState();
}

class _WalkInFormScreenState extends State<WalkInFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _mobile = TextEditingController();
  final _age = TextEditingController();
  final _address = TextEditingController();
  final _city = TextEditingController();
  final _state = TextEditingController();
  final _pincode = TextEditingController();
  final _description = TextEditingController();

  /// Patients already on the number. Null [_profileId] means a new patient —
  /// never a lookup by name.
  List<PatientProfile> _patients = const [];
  String? _profileId;
  bool _looking = false;

  String? _gender;
  String? _date;
  Slot? _slot;
  bool _submitting = false;
  bool _slotError = false;

  // Resolved doctor for the booking.
  String? _doctorId;
  List<Doctor> _doctors = [];
  bool _loadingDoctor = true;
  String? _loadError;

  ApiClient get _api => AuthScope.of(context).api;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _resolveDoctor();
  }

  @override
  void dispose() {
    _name.dispose();
    _mobile.dispose();
    _address.dispose();
    _city.dispose();
    _state.dispose();
    _pincode.dispose();
    _age.dispose();
    _description.dispose();
    super.dispose();
  }

  Future<void> _resolveDoctor() async {
    if (!_loadingDoctor) return;
    final auth = AuthScope.of(context);
    // Every clinic account — the doctor and the staff they add — is linked to
    // the clinic's doctor profile and books against it.
    if (auth.user?.doctorId != null) {
      setState(() {
        _doctorId = auth.user!.doctorId;
        _loadingDoctor = false;
      });
      return;
    }
    try {
      final docs = (await auth.api.listDoctors())
          .where((d) => d.isEnabled)
          .toList();
      setState(() {
        _doctors = docs;
        _doctorId = docs.length == 1 ? docs.first.id : null;
        _loadingDoctor = false;
      });
    } catch (_) {
      setState(() {
        _loadError = 'Could not load doctors.';
        _loadingDoctor = false;
      });
    }
  }

  /// A walk-in is a full registration: the same account and patient rows a
  /// self-booking creates, so the patient can log in with this number
  /// afterwards and find the visit waiting.
  Future<void> _lookUpPatients() async {
    final mobile = _mobile.text.trim();
    if (!RegExp(r'^[6-9]\d{9}$').hasMatch(mobile)) {
      setState(() {
        _patients = const [];
        _profileId = null;
      });
      return;
    }
    setState(() => _looking = true);
    try {
      final list = await _api.patientsByMobile(mobile);
      if (mounted) setState(() => _patients = list);
    } on ApiException catch (e) {
      if (mounted) showErrorSnack(context, e.message);
    } finally {
      if (mounted) setState(() => _looking = false);
    }
  }

  /// Picking an existing patient prefills their details; they stay editable,
  /// since people move and ages change between visits.
  void _applyPatient(PatientProfile? p) {
    setState(() {
      _profileId = p?.id;
      _name.text = p?.name ?? '';
      _gender = (p?.gender?.isNotEmpty ?? false) ? p!.gender : null;
      _age.text = p?.lastAge?.toString() ?? '';
      _address.text = p?.addressLine ?? '';
      _city.text = p?.city ?? '';
      _state.text = p?.state ?? '';
      _pincode.text = p?.pincode ?? '';
    });
  }

  Future<void> _submit() async {
    final formOk = _formKey.currentState!.validate();
    final slotOk = _slot != null && _date != null;
    setState(() => _slotError = !slotOk);
    if (!formOk || !slotOk) return;
    if (_doctorId == null) {
      showErrorSnack(context, 'Please select a doctor.');
      return;
    }

    setState(() => _submitting = true);
    try {
      await _api.bookWalkIn({
        'doctor_id': _doctorId,
        'appointment_date': _date,
        'start_time': _slot!.startTime,
        'patient_name': _name.text.trim(),
        'patient_mobile': _mobile.text.trim(),
        'patient_gender': _gender,
        'patient_age': int.parse(_age.text.trim()),
        if (_profileId != null) 'patient_profile_id': _profileId,
        'patient_address': _address.text.trim(),
        'patient_city': _city.text.trim(),
        'patient_state': _state.text.trim(),
        'patient_pincode': _pincode.text.trim(),
        if (_description.text.trim().isNotEmpty)
          'description': _description.text.trim(),
      });
      if (!mounted) return;
      showSuccessSnack(context, 'Walk-in booked');
      Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _submitting = false);
      showErrorSnack(context, e.message);
    } catch (_) {
      if (!mounted) return;
      setState(() => _submitting = false);
      showErrorSnack(context, 'Something went wrong. Please try again.');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Walk-in appointment')),
      body: _loadingDoctor
          ? const StateView(loading: true)
          : _loadError != null
              ? StateView(error: _loadError)
              : Form(
                  key: _formKey,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      if (_doctors.length > 1) _doctorField(),
                      _field(_name, 'Patient name *', validator: (v) {
                        if ((v ?? '').trim().length < 2) {
                          return 'Please enter the patient’s name.';
                        }
                        return null;
                      }),
                      _field(_mobile, 'Mobile number *',
                          keyboard: TextInputType.phone,
                          inputFormatters: [
                            FilteringTextInputFormatter.digitsOnly,
                            LengthLimitingTextInputFormatter(10),
                          ],
                          onChanged: (_) => _lookUpPatients(),
                          validator: (v) {
                        final s = (v ?? '').trim();
                        if (s.isEmpty) return 'Mobile number is required.';
                        if (!RegExp(r'^[6-9]\d{9}$').hasMatch(s)) {
                          return 'Enter a valid 10-digit mobile number.';
                        }
                        return null;
                      }),
                      if (_looking)
                        const Padding(
                          padding: EdgeInsets.only(bottom: 14),
                          child: LinearProgressIndicator(),
                        )
                      else if (_patients.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 14),
                          child: DropdownButtonFormField<String>(
                            initialValue: _profileId,
                            decoration: const InputDecoration(
                                labelText: 'Patient on this number *'),
                            items: [
                              const DropdownMenuItem(
                                  value: null,
                                  child: Text('+ New patient on this number')),
                              for (final p in _patients)
                                DropdownMenuItem(
                                  value: p.id,
                                  child: Text('${p.name} · ${p.subtitle}',
                                      overflow: TextOverflow.ellipsis),
                                ),
                            ],
                            onChanged: (v) {
                              final hit = _patients.where((x) => x.id == v);
                              _applyPatient(hit.isEmpty ? null : hit.first);
                            },
                          ),
                        ),
                      _genderField(),
                      _field(_age, 'Age *',
                          keyboard: TextInputType.number,
                          inputFormatters: [
                            FilteringTextInputFormatter.digitsOnly,
                            LengthLimitingTextInputFormatter(3),
                          ], validator: (v) {
                        final s = (v ?? '').trim();
                        if (s.isEmpty) return 'Age is required.';
                        final n = int.tryParse(s);
                        if (n == null || n < 0 || n > 120) {
                          return 'Enter a valid age.';
                        }
                        return null;
                      }),
                      _field(_address, 'Address *', maxLines: 2, validator: (v) {
                        if ((v ?? '').trim().length < 3) {
                          return 'Please enter the address.';
                        }
                        return null;
                      }),
                      _field(_city, 'City *', validator: (v) {
                        if ((v ?? '').trim().length < 2) {
                          return 'Please enter the city.';
                        }
                        return null;
                      }),
                      _field(_state, 'State *', validator: (v) {
                        if ((v ?? '').trim().length < 2) {
                          return 'Please enter the state.';
                        }
                        return null;
                      }),
                      _field(_pincode, 'PIN code *',
                          keyboard: TextInputType.number,
                          inputFormatters: [
                            FilteringTextInputFormatter.digitsOnly,
                            LengthLimitingTextInputFormatter(6),
                          ], validator: (v) {
                        if (!RegExp(r'^[1-9]\d{5}$')
                            .hasMatch((v ?? '').trim())) {
                          return 'Enter a valid 6-digit PIN code.';
                        }
                        return null;
                      }),
                      _field(_description, 'Reason for visit (optional)',
                          maxLines: 2),
                      const Padding(
                        padding: EdgeInsets.only(bottom: 8),
                        child: Text(
                          'This registers the patient — they can log in with '
                          'this number afterwards to see the visit, its reports '
                          'and the prescription.',
                          style: TextStyle(
                              color: AppColors.textSecondary, fontSize: 12),
                        ),
                      ),
                      const SizedBox(height: 8),
                      SectionCard(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const CardTitle('Choose a slot *'),
                            if (_doctorId != null)
                              SlotSelector(
                                api: _api,
                                doctorId: _doctorId!,
                                allowPast: true,
                                onChanged: (date, slot) {
                                  _date = date;
                                  _slot = slot;
                                  if (_slotError && slot != null) {
                                    setState(() => _slotError = false);
                                  }
                                },
                              )
                            else
                              const Text('Select a doctor first.',
                                  style: TextStyle(
                                      color: AppColors.textSecondary)),
                            if (_slotError) ...[
                              const SizedBox(height: 8),
                              const Text('Please choose a slot.',
                                  style: TextStyle(
                                      color: AppColors.error, fontSize: 12)),
                            ],
                          ],
                        ),
                      ),
                      const SizedBox(height: 20),
                      SizedBox(
                        height: 50,
                        child: ElevatedButton(
                          onPressed: _submitting ? null : _submit,
                          child: _submitting
                              ? const SizedBox(
                                  width: 20,
                                  height: 20,
                                  child: CircularProgressIndicator(
                                      strokeWidth: 2.2, color: Colors.white))
                              : const Text('Book walk-in'),
                        ),
                      ),
                      const SizedBox(height: 8),
                      const Center(
                        child: Text('Payment is collected in person at the clinic.',
                            style: TextStyle(
                                color: AppColors.textSecondary, fontSize: 12)),
                      ),
                      const SizedBox(height: 24),
                    ],
                  ),
                ),
    );
  }

  Widget _doctorField() {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: DropdownButtonFormField<String>(
        initialValue: _doctorId,
        isExpanded: true,
        decoration: const InputDecoration(labelText: 'Doctor *'),
        items: _doctors
            .map((d) => DropdownMenuItem(value: d.id, child: Text(d.name)))
            .toList(),
        validator: (v) => v == null ? 'Please select a doctor.' : null,
        onChanged: (v) => setState(() => _doctorId = v),
      ),
    );
  }

  Widget _genderField() {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: DropdownButtonFormField<String>(
        initialValue: _gender,
        decoration: const InputDecoration(labelText: 'Gender *'),
        items: const [
          DropdownMenuItem(value: 'male', child: Text('Male')),
          DropdownMenuItem(value: 'female', child: Text('Female')),
          DropdownMenuItem(value: 'other', child: Text('Other')),
        ],
        validator: (v) => v == null ? 'Please select a gender.' : null,
        onChanged: (v) => setState(() => _gender = v),
      ),
    );
  }

  Widget _field(
    TextEditingController c,
    String label, {
    TextInputType? keyboard,
    int maxLines = 1,
    List<TextInputFormatter>? inputFormatters,
    String? Function(String?)? validator,
    ValueChanged<String>? onChanged,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: TextFormField(
        controller: c,
        keyboardType: keyboard,
        maxLines: maxLines,
        inputFormatters: inputFormatters,
        validator: validator,
        onChanged: onChanged,
        decoration: InputDecoration(labelText: label),
      ),
    );
  }
}
