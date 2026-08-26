import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../api/api_client.dart';
import '../api/models.dart';
import '../auth/patient_scope.dart';
import '../doctor_context.dart';
import '../theme.dart';

/// Phone-only login/register — no password, no OTP.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _mobile = TextEditingController();
  // Registering creates one patient, so it asks for a patient's full details —
  // the same set booking and the front desk collect.
  final _name = TextEditingController();
  final _age = TextEditingController();
  final _address = TextEditingController();
  final _city = TextEditingController();
  final _state = TextEditingController();
  final _pincode = TextEditingController();
  String? _gender;
  bool _registerMode = false;
  bool _submitting = false;
  String? _error;

  bool get _mobileValid => RegExp(r'^[6-9]\d{9}$').hasMatch(_mobile.text.trim());

  @override
  void dispose() {
    _mobile.dispose();
    _name.dispose();
    _age.dispose();
    _address.dispose();
    _city.dispose();
    _state.dispose();
    _pincode.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() => _error = null);
    if (!_mobileValid) {
      setState(() => _error = 'Enter a valid 10-digit mobile number.');
      return;
    }
    if (_registerMode) {
      final problem = _detailsProblem();
      if (problem != null) {
        setState(() => _error = problem);
        return;
      }
    }
    setState(() => _submitting = true);
    final auth = PatientAuthScope.of(context);
    final doctorId = DoctorContextScope.of(context).doctor?.id;
    try {
      if (_registerMode) {
        await auth.register(
          _mobile.text.trim(),
          PatientDetails(
            name: _name.text.trim(),
            gender: _gender,
            age: int.tryParse(_age.text.trim()),
            addressLine: _address.text.trim(),
            city: _city.text.trim(),
            state: _state.text.trim(),
            pincode: _pincode.text.trim(),
          ),
          doctorId: doctorId,
        );
      } else {
        await auth.login(_mobile.text.trim(), doctorId: doctorId);
      }
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (e.code == 'PATIENT_NOT_FOUND') {
        setState(() {
          _registerMode = true;
          _error =
              'No patient registered on this number. Add their details to register.';
        });
      } else {
        setState(() => _error = e.message);
      }
    } catch (_) {
      setState(() => _error = 'Something went wrong. Please try again.');
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  /// The registration form is one patient's details; returns the first problem.
  String? _detailsProblem() {
    if (_name.text.trim().length < 2) return 'Please enter the patient\u2019s name.';
    if (_gender == null) return 'Please select a gender.';
    final age = int.tryParse(_age.text.trim());
    if (age == null || age < 0 || age > 120) return 'Enter a valid age.';
    if (_address.text.trim().length < 3) return 'Please enter the address.';
    if (_city.text.trim().length < 2) return 'Please enter the city.';
    if (_state.text.trim().length < 2) return 'Please enter the state.';
    if (!RegExp(r'^[1-9]\d{5}$').hasMatch(_pincode.text.trim())) {
      return 'Enter a valid 6-digit PIN code.';
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(_registerMode ? 'Register patient' : 'Login')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            _registerMode ? 'Create your account' : 'Login to your account',
            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 6),
          Text(
            _registerMode
                ? "We didn't find this number — add the patient's details to register."
                : 'Use the mobile number you booked your OPD appointment with.',
            style: const TextStyle(color: AppColors.textSecondary),
          ),
          const SizedBox(height: 20),
          TextField(
            controller: _mobile,
            keyboardType: TextInputType.phone,
            inputFormatters: [
              FilteringTextInputFormatter.digitsOnly,
              LengthLimitingTextInputFormatter(10),
            ],
            decoration: const InputDecoration(labelText: 'Mobile number'),
          ),
          if (_registerMode) ...[
            const SizedBox(height: 14),
            TextField(
              controller: _name,
              decoration:
                  const InputDecoration(labelText: 'Patient\u2019s full name'),
            ),
            const SizedBox(height: 14),
            DropdownButtonFormField<String>(
              initialValue: _gender,
              decoration: const InputDecoration(labelText: 'Gender'),
              items: const [
                DropdownMenuItem(value: 'male', child: Text('Male')),
                DropdownMenuItem(value: 'female', child: Text('Female')),
                DropdownMenuItem(value: 'other', child: Text('Other')),
              ],
              onChanged: (v) => setState(() => _gender = v),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: _age,
              keyboardType: TextInputType.number,
              inputFormatters: [
                FilteringTextInputFormatter.digitsOnly,
                LengthLimitingTextInputFormatter(3),
              ],
              decoration: const InputDecoration(labelText: 'Age'),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: _address,
              maxLines: 2,
              decoration: const InputDecoration(labelText: 'Address'),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: _city,
              decoration: const InputDecoration(labelText: 'City'),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: _state,
              decoration: const InputDecoration(labelText: 'State'),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: _pincode,
              keyboardType: TextInputType.number,
              inputFormatters: [
                FilteringTextInputFormatter.digitsOnly,
                LengthLimitingTextInputFormatter(6),
              ],
              decoration: const InputDecoration(labelText: 'PIN code'),
            ),
          ],
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(_error!, style: const TextStyle(color: AppColors.error, fontSize: 13)),
          ],
          const SizedBox(height: 20),
          SizedBox(
            height: 50,
            child: ElevatedButton(
              onPressed: _submitting ? null : _submit,
              child: _submitting
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2.2, color: Colors.white))
                  : Text(_registerMode ? 'Register' : 'Login'),
            ),
          ),
          const SizedBox(height: 14),
          Center(
            child: TextButton(
              onPressed: () => setState(() {
                _registerMode = !_registerMode;
                _error = null;
              }),
              child: Text(_registerMode ? 'Login instead' : 'New here? Register instead'),
            ),
          ),
        ],
      ),
    );
  }
}

/// Shown in place of a locked screen when the patient isn't signed in yet.
class LoginPrompt extends StatelessWidget {
  final String message;
  const LoginPrompt({super.key, required this.message});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.lock_outline, size: 40, color: AppColors.textSecondary),
            const SizedBox(height: 12),
            Text(message, textAlign: TextAlign.center,
                style: const TextStyle(color: AppColors.textSecondary)),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: () => Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const LoginScreen()),
              ),
              child: const Text('Login / Register'),
            ),
          ],
        ),
      ),
    );
  }
}
