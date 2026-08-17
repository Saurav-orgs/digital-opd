import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import '../api/api_client.dart';
import '../api/models.dart';
import '../config.dart';
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

class _BookingFormScreenState extends State<BookingFormScreen> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _mobile = TextEditingController();
  final _name = TextEditingController();
  final _age = TextEditingController();
  final _address = TextEditingController();
  final _description = TextEditingController();

  String? _gender; // male | female | other
  File? _screenshot;
  bool _submitting = false;
  String? _fileError;

  @override
  void dispose() {
    _mobile.dispose();
    _name.dispose();
    _age.dispose();
    _address.dispose();
    _description.dispose();
    super.dispose();
  }

  Future<void> _pickImage() async {
    final picker = ImagePicker();
    final picked = await picker.pickImage(
      source: ImageSource.gallery,
      imageQuality: 85,
    );
    if (picked == null) return;
    final file = File(picked.path);
    final sizeMb = (await file.length()) / (1024 * 1024);
    if (sizeMb > AppConfig.maxUploadMb) {
      setState(() {
        _screenshot = null;
        _fileError = 'Image is too large. Please choose one up to ${AppConfig.maxUploadMb} MB.';
      });
      return;
    }
    setState(() {
      _screenshot = file;
      _fileError = null;
    });
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    if (_screenshot == null) {
      setState(() => _fileError = 'Please upload your payment screenshot.');
      return;
    }
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
        patientAddress: _address.text.trim(),
        description: _description.text.trim(),
        screenshot: _screenshot!,
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

  @override
  Widget build(BuildContext context) {
    final d = widget.doctor;
    return Scaffold(
      appBar: AppBar(title: const Text('Your details')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _summary(),
            const SizedBox(height: 16),
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
            _field(_name, 'Full name *', validator: (v) {
              if ((v ?? '').trim().length < 2) return 'Please enter your name.';
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
            _field(_address, 'Address (optional)', maxLines: 2),
            _field(_description, 'Reason for visit (optional)', maxLines: 2),
            const SizedBox(height: 8),
            if (d.paymentQrUrl != null && d.paymentQrUrl!.isNotEmpty) _qrCard(d),
            const SizedBox(height: 16),
            _uploadCard(),
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
            const SizedBox(height: 8),
            const Center(
              child: Text('Your booking is confirmed once the screenshot is uploaded.',
                  style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
            ),
            const SizedBox(height: 24),
          ],
        ),
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

  Widget _qrCard(Doctor d) {
    return SectionCard(
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Scan & pay',
                  style: TextStyle(fontWeight: FontWeight.w500)),
              if (d.consultationFee != null)
                Text(d.feeLabel,
                    style: const TextStyle(
                        fontWeight: FontWeight.w500,
                        color: AppColors.secondary)),
            ],
          ),
          const SizedBox(height: 12),
          ClipRRect(
            borderRadius: BorderRadius.circular(AppRadius.control),
            child: Image.network(
              d.paymentQrUrl!,
              height: 200,
              fit: BoxFit.contain,
              errorBuilder: (_, __, ___) => const Padding(
                padding: EdgeInsets.all(20),
                child: Text('Could not load the QR code.',
                    style: TextStyle(color: AppColors.textSecondary)),
              ),
            ),
          ),
          const SizedBox(height: 8),
          const Text('Pay via any UPI app, then upload the screenshot below.',
              style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
              textAlign: TextAlign.center),
        ],
      ),
    );
  }

  Widget _uploadCard() {
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Payment screenshot *',
              style: TextStyle(fontWeight: FontWeight.w500)),
          const SizedBox(height: 10),
          if (_screenshot != null)
            Column(
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(AppRadius.control),
                  child: Image.file(_screenshot!,
                      height: 160, width: double.infinity, fit: BoxFit.cover),
                ),
                const SizedBox(height: 10),
              ],
            ),
          OutlinedButton.icon(
            onPressed: _pickImage,
            icon: const Icon(Icons.upload_file, size: 18),
            label: Text(_screenshot == null ? 'Upload screenshot' : 'Change screenshot'),
            style: OutlinedButton.styleFrom(
              foregroundColor: AppColors.primary,
              side: const BorderSide(color: AppColors.border, width: 0.5),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(AppRadius.control)),
            ),
          ),
          if (_fileError != null) ...[
            const SizedBox(height: 6),
            Text(_fileError!,
                style: const TextStyle(color: AppColors.error, fontSize: 12)),
          ],
          const SizedBox(height: 4),
          const Text('JPG, PNG or WebP · up to 5 MB.',
              style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
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
