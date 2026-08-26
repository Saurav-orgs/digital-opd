import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../api/api_client.dart';
import '../api/models.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'confirmation_screen.dart';

class BookingFormScreen extends StatefulWidget {
  final Doctor doctor;
  final String date;
  final Slot slot;
  const BookingFormScreen({
    super.key,
    required this.doctor,
    required this.date,
    required this.slot,
  });

  @override
  State<BookingFormScreen> createState() => _BookingFormScreenState();
}

/// Booking runs in three stages, mirroring the web app:
///   mobile → who the visit is for → their details.
/// The middle stage is skipped when the number has nobody on it yet.
enum _Step { mobile, choosePatient, details }

class _BookingFormScreenState extends State<BookingFormScreen> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _mobileKey = GlobalKey<FormState>();
  final _mobile = TextEditingController();
  final _name = TextEditingController();
  final _age = TextEditingController();
  final _address = TextEditingController();
  final _city = TextEditingController();
  final _state = TextEditingController();
  final _pincode = TextEditingController();
  final _description = TextEditingController();

  String? _gender; // male | female | other
  bool _submitting = false;

  _Step _step = _Step.mobile;
  List<PatientProfile> _known = const [];
  bool _identifying = false;

  /// Null means "a new patient" — never "find one by name".
  String? _profileId;

  @override
  void dispose() {
    _mobile.dispose();
    _name.dispose();
    _age.dispose();
    _address.dispose();
    _city.dispose();
    _state.dispose();
    _pincode.dispose();
    _description.dispose();
    super.dispose();
  }

  /// Step 1: find out who is already registered on this number. A number nobody
  /// has used becomes an account and goes straight to the details form.
  Future<void> _identify() async {
    if (!_mobileKey.currentState!.validate()) return;
    setState(() => _identifying = true);
    try {
      final res = await _api.identify(_mobile.text.trim());
      if (!mounted) return;
      setState(() {
        _known = res.patients;
        _identifying = false;
        _step = res.patients.isEmpty ? _Step.details : _Step.choosePatient;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _identifying = false);
      showErrorSnack(context, e.message);
    } catch (_) {
      if (!mounted) return;
      setState(() => _identifying = false);
      showErrorSnack(context, 'Could not check this number. Please try again.');
    }
  }

  /// Chose an existing patient — prefill, but keep everything editable.
  void _choose(PatientProfile p) {
    setState(() {
      _profileId = p.id;
      _name.text = p.name;
      _gender = (p.gender?.isNotEmpty ?? false) ? p.gender : null;
      _age.text = p.lastAge?.toString() ?? '';
      _address.text = p.addressLine ?? '';
      _city.text = p.city ?? '';
      _state.text = p.state ?? '';
      _pincode.text = p.pincode ?? '';
      _step = _Step.details;
    });
  }

  /// Chose "new patient" — a blank form and no profile id. Typing a name that
  /// matches an existing patient still creates a separate record.
  void _chooseNew() {
    setState(() {
      _profileId = null;
      _name.clear();
      _gender = null;
      _age.clear();
      _address.clear();
      _city.clear();
      _state.clear();
      _pincode.clear();
      _step = _Step.details;
    });
  }

  /// Back one stage; returns false when there is nowhere left to go.
  bool _back() {
    if (_step == _Step.details) {
      setState(() => _step = _known.isEmpty ? _Step.mobile : _Step.choosePatient);
      return true;
    }
    if (_step == _Step.choosePatient) {
      setState(() => _step = _Step.mobile);
      return true;
    }
    return false;
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _submitting = true);
    try {
      final result = await _api.book(
        doctorId: widget.doctor.id,
        date: widget.date,
        startTime: widget.slot.startTime,
        patientName: _name.text.trim(),
        patientMobile: _mobile.text.trim(),
        patientGender: _gender!,
        patientAge: int.parse(_age.text.trim()),
        patientProfileId: _profileId,
        patientAddress: _address.text.trim(),
        patientCity: _city.text.trim(),
        patientState: _state.text.trim(),
        patientPincode: _pincode.text.trim(),
        description: _description.text.trim(),
      );
      if (!mounted) return;
      Navigator.pushReplacement(
        context,
        MaterialPageRoute(
          builder: (_) => ConfirmationScreen(result: result, doctor: widget.doctor),
        ),
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _submitting = false);
      // If the slot was taken/expired, send them back to re-pick.
      if (e.code == 'SLOT_ALREADY_BOOKED' || e.code == 'SLOT_IN_PAST') {
        showErrorSnack(context, e.message);
        Navigator.pop(context);
      } else {
        showErrorSnack(context, e.message);
      }
    } catch (_) {
      if (!mounted) return;
      setState(() => _submitting = false);
      showErrorSnack(context, 'Something went wrong. Please try again.');
    }
  }

  static const _titles = {
    _Step.mobile: 'Mobile number',
    _Step.choosePatient: 'Who is this visit for?',
    _Step.details: 'Patient details',
  };

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: _step == _Step.mobile,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _back();
      },
      child: Scaffold(
        appBar: AppBar(title: Text(_titles[_step]!)),
        body: switch (_step) {
          _Step.mobile => _mobileStep(),
          _Step.choosePatient => _choosePatientStep(),
          _Step.details => _detailsStep(),
        },
      ),
    );
  }

  Widget _mobileStep() {
    return Form(
      key: _mobileKey,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _summary(),
          const SizedBox(height: 16),
          const Text(
            'We use this to find your existing records, and to reach you about '
            'the visit.',
            style: TextStyle(color: AppColors.textSecondary),
          ),
          const SizedBox(height: 14),
          _field(_mobile, 'Mobile number *',
              keyboard: TextInputType.phone,
              inputFormatters: [
                FilteringTextInputFormatter.digitsOnly,
                LengthLimitingTextInputFormatter(10),
              ],
              validator: (v) {
            final s = (v ?? '').trim();
            if (s.isEmpty) return 'Mobile number is required.';
            if (!RegExp(r'^[6-9]\d{9}$').hasMatch(s)) {
              return 'Enter a valid 10-digit mobile number.';
            }
            return null;
          }),
          const SizedBox(height: 10),
          SizedBox(
            height: 50,
            child: ElevatedButton(
              onPressed: _identifying ? null : _identify,
              child: _identifying
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                          strokeWidth: 2.2, color: Colors.white))
                  : const Text('Continue'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _choosePatientStep() {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _summary(),
        const SizedBox(height: 16),
        const Text(
          'Choose an existing patient to add this visit to their history, or '
          'add a new patient on this number.',
          style: TextStyle(color: AppColors.textSecondary),
        ),
        const SizedBox(height: 12),
        for (final p in _known)
          Card(
            margin: const EdgeInsets.only(bottom: 10),
            child: ListTile(
              title: Text(p.name,
                  style: const TextStyle(fontWeight: FontWeight.w600)),
              subtitle: Text(
                '${p.subtitle}\n'
                '${p.lastVisitDate != null ? 'Last visit ${p.lastVisitDate}' : 'No visits yet'}',
              ),
              isThreeLine: true,
              trailing: const Icon(Icons.chevron_right),
              onTap: () => _choose(p),
            ),
          ),
        Card(
          shape: RoundedRectangleBorder(
            side: const BorderSide(color: AppColors.textSecondary, width: 0.6),
            borderRadius: BorderRadius.circular(AppRadius.control),
          ),
          child: ListTile(
            leading: const Icon(Icons.person_add_alt, color: AppColors.primary),
            title: const Text('New patient',
                style: TextStyle(fontWeight: FontWeight.w600)),
            subtitle: const Text(
                'Someone not listed above — a family member on this number'),
            onTap: _chooseNew,
          ),
        ),
      ],
    );
  }

  Widget _detailsStep() {
    return Form(
      key: _formKey,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _summary(),
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                '${_profileId != null ? 'Existing patient' : 'New patient'} · ${_mobile.text}',
                style: const TextStyle(color: AppColors.textSecondary),
              ),
              TextButton(onPressed: _back, child: const Text('Change')),
            ],
          ),
          const SizedBox(height: 4),
          _field(_name, 'Full name *', validator: (v) {
            if ((v ?? '').trim().length < 2) {
              return 'Please enter the patient\u2019s name.';
            }
            return null;
          }),
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
            if (n == null || n < 0 || n > 120) return 'Enter a valid age.';
            return null;
          }),
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
          _field(_description, 'Reason for visit (optional)', maxLines: 2),
          const SizedBox(height: 24),
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
                  : const Text('Confirm booking'),
            ),
          ),
          const SizedBox(height: 24),
        ],
      ),
    );
  }

  Widget _summary() {
    return SectionCard(
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: AppColors.primaryTint,
              borderRadius: BorderRadius.circular(AppRadius.control),
            ),
            child: const Icon(Icons.event_available, color: AppColors.primary),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(widget.doctor.name,
                    style: const TextStyle(fontWeight: FontWeight.w500)),
                const SizedBox(height: 2),
                Text('${widget.date} · ${widget.slot.startTime}–${widget.slot.endTime}',
                    style: const TextStyle(color: AppColors.textSecondary)),
              ],
            ),
          ),
        ],
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
  }) {
    return Padding(
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
}
