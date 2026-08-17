import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../api/api_client.dart';
import '../auth/patient_scope.dart';
import '../theme.dart';

/// Phone-only login/register — no password, no OTP.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _mobile = TextEditingController();
  final _name = TextEditingController();
  bool _registerMode = false;
  bool _submitting = false;
  String? _error;

  bool get _mobileValid => RegExp(r'^[6-9]\d{9}$').hasMatch(_mobile.text.trim());

  @override
  void dispose() {
    _mobile.dispose();
    _name.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() => _error = null);
    if (!_mobileValid) {
      setState(() => _error = 'Enter a valid 10-digit mobile number.');
      return;
    }
    if (_registerMode && _name.text.trim().length < 2) {
      setState(() => _error = 'Please enter your name.');
      return;
    }
    setState(() => _submitting = true);
    final auth = PatientAuthScope.of(context);
    try {
      if (_registerMode) {
        await auth.register(_mobile.text.trim(), _name.text.trim());
      } else {
        await auth.login(_mobile.text.trim());
      }
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (e.code == 'PATIENT_NOT_FOUND') {
        setState(() {
          _registerMode = true;
          _error = 'No account found. Please enter your name to register.';
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(_registerMode ? 'Create account' : 'Login')),
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
                ? "We didn't find an account for this number — enter your name to register."
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
              decoration: const InputDecoration(labelText: 'Full name'),
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
