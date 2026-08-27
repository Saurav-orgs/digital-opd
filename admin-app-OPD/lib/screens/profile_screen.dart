import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'package:share_plus/share_plus.dart';
import '../api/api_client.dart';
import '../api/models.dart';
import '../auth/auth_scope.dart';
import '../config.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'doctor_schedule_screen.dart';

/// The doctor's own home — profile details, photo and a shortcut to their OPD
/// schedule. The SuperAdmin is the clinic's single doctor, so there is no
/// separate "Doctor Profile" screen; everything lives here. Edits are
/// permission-gated server-side (doctors:update).
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  Future<Doctor>? _future;

  final _name = TextEditingController();
  final _specialization = TextEditingController();
  final _qualifications = TextEditingController();
  final _bio = TextEditingController();
  final _fee = TextEditingController();

  final _clinicName = TextEditingController();
  final _clinicAddress = TextEditingController();
  final _clinicPhone = TextEditingController();

  bool _saving = false;
  bool _uploadingPhoto = false;
  bool _savingLetterhead = false;
  bool _uploadingLogo = false;

  AuthController get _auth => AuthScope.of(context);
  bool get _canEdit => _auth.can('doctors', 'update');
  bool get _canSchedule => _auth.can('opd_schedules', 'read');

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _future ??= _auth.api.getMe().then((d) {
      _populate(d);
      return d;
    });
  }

  void _populate(Doctor d) {
    _name.text = d.name;
    _specialization.text = d.specialization ?? '';
    _qualifications.text = d.qualifications ?? '';
    _bio.text = d.bio ?? '';
    _fee.text = d.consultationFee ?? '';
    _clinicName.text = d.clinicName ?? '';
    _clinicAddress.text = d.clinicAddress ?? '';
    _clinicPhone.text = d.clinicPhone ?? '';
  }

  void _reload() {
    setState(() {
      _future = _auth.api.getMe().then((d) {
        _populate(d);
        return d;
      });
    });
  }

  @override
  void dispose() {
    _name.dispose();
    _specialization.dispose();
    _qualifications.dispose();
    _bio.dispose();
    _fee.dispose();
    _clinicName.dispose();
    _clinicAddress.dispose();
    _clinicPhone.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      final feeNum = _fee.text.trim().isEmpty ? null : _fee.text.trim();
      final updated = await _auth.api.updateMe({
        'name': _name.text.trim(),
        'specialization':
            _specialization.text.trim().isEmpty ? null : _specialization.text.trim(),
        'qualifications':
            _qualifications.text.trim().isEmpty ? null : _qualifications.text.trim(),
        'bio': _bio.text.trim().isEmpty ? null : _bio.text.trim(),
        'consultation_fee': feeNum == null ? null : num.tryParse(feeNum),
      });
      _populate(updated);
      if (mounted) showSuccessSnack(context, 'Profile saved');
    } on ApiException catch (e) {
      if (mounted) showErrorSnack(context, e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _uploadPhoto() async {
    final picked = await ImagePicker()
        .pickImage(source: ImageSource.gallery, imageQuality: 85);
    if (picked == null) return;
    final file = File(picked.path);
    setState(() => _uploadingPhoto = true);
    try {
      await _auth.api.uploadMyPhoto(file);
      _reload();
      if (mounted) showSuccessSnack(context, 'Profile photo updated');
    } on ApiException catch (e) {
      if (mounted) showErrorSnack(context, e.message);
    } finally {
      if (mounted) setState(() => _uploadingPhoto = false);
    }
  }

  Future<void> _saveLetterhead() async {
    setState(() => _savingLetterhead = true);
    try {
      await _auth.api.updateMe({
        'clinic_name':
            _clinicName.text.trim().isEmpty ? null : _clinicName.text.trim(),
        'clinic_address':
            _clinicAddress.text.trim().isEmpty ? null : _clinicAddress.text.trim(),
        'clinic_phone':
            _clinicPhone.text.trim().isEmpty ? null : _clinicPhone.text.trim(),
      });
      if (mounted) showSuccessSnack(context, 'Letterhead updated');
    } on ApiException catch (e) {
      if (mounted) showErrorSnack(context, e.message);
    } finally {
      if (mounted) setState(() => _savingLetterhead = false);
    }
  }

  Future<void> _uploadLogo() async {
    final picked = await ImagePicker()
        .pickImage(source: ImageSource.gallery, imageQuality: 90);
    if (picked == null) return;
    final file = File(picked.path);
    setState(() => _uploadingLogo = true);
    try {
      await _auth.api.uploadMyLetterheadLogo(file);
      _reload();
      if (mounted) showSuccessSnack(context, 'Letterhead logo updated');
    } on ApiException catch (e) {
      if (mounted) showErrorSnack(context, e.message);
    } finally {
      if (mounted) setState(() => _uploadingLogo = false);
    }
  }

  void _openSchedule(Doctor me) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) =>
            DoctorScheduleScreen(doctorId: me.id, doctorName: me.name),
      ),
    );
  }

  Widget _qrCard(Doctor me) {
    final base = (me.profileBaseUrl != null && me.profileBaseUrl!.trim().isNotEmpty)
        ? me.profileBaseUrl!.trim().replaceAll(RegExp(r'/+$'), '')
        : AppConfig.patientWebBase;
    final url = me.bookingUrl ?? '$base/d/${me.publicSlug}';

    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const CardTitle('My booking link & QR'),
          const Text(
            'Share this link or QR code with patients to book appointments directly.',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
          ),
          if (me.qrCodeUrl != null && me.qrCodeUrl!.isNotEmpty) ...[
            const SizedBox(height: 14),
            Center(
              child: Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(AppRadius.control),
                  border: Border.all(color: AppColors.border, width: 0.5),
                ),
                child: Image.network(
                  me.qrCodeUrl!,
                  height: 150,
                  width: 150,
                  fit: BoxFit.contain,
                  errorBuilder: (_, _, _) => const Icon(Icons.qr_code, size: 80, color: AppColors.textSecondary),
                ),
              ),
            ),
          ],
          const SizedBox(height: 12),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            decoration: BoxDecoration(
              color: AppColors.page,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(
              url,
              style: const TextStyle(
                fontSize: 12,
                fontFamily: 'monospace',
                color: AppColors.textSecondary,
              ),
            ),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () {
                    Clipboard.setData(ClipboardData(text: url));
                    showSuccessSnack(context, 'Link copied');
                  },
                  icon: const Icon(Icons.copy, size: 16),
                  label: const Text('Copy link'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: ElevatedButton.icon(
                  onPressed: () {
                    SharePlus.instance.share(
                      ShareParams(
                        text: 'Book an appointment with ${me.name}:\n$url',
                        subject: 'Book OPD Appointment with ${me.name}',
                      ),
                    );
                  },
                  icon: const Icon(Icons.share, size: 16),
                  label: const Text('Share'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<Doctor>(
      future: _future,
      builder: (context, snap) {
        if (snap.connectionState == ConnectionState.waiting) {
          return const StateView(loading: true);
        }
        if (snap.hasError) {
          return StateView(
              error: 'Could not load your profile.', onRetry: _reload);
        }
        final me = snap.data!;
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (!_canEdit)
              const Padding(
                padding: EdgeInsets.only(bottom: 12),
                child: Text(
                  "Read-only — your role doesn't grant profile editing.",
                  style: TextStyle(color: AppColors.textSecondary),
                ),
              ),
            SectionCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  LabeledField(
                    label: 'Name',
                    child: TextField(controller: _name, enabled: _canEdit),
                  ),
                  LabeledField(
                    label: 'Specialization',
                    child: TextField(
                        controller: _specialization, enabled: _canEdit),
                  ),
                  LabeledField(
                    label: 'Qualifications',
                    child: TextField(
                        controller: _qualifications, enabled: _canEdit),
                  ),
                  LabeledField(
                    label: 'Consultation fee (₹)',
                    child: TextField(
                        controller: _fee,
                        enabled: _canEdit,
                        keyboardType: TextInputType.number),
                  ),
                  LabeledField(
                    label: 'Bio',
                    child: TextField(
                        controller: _bio, enabled: _canEdit, maxLines: 4),
                  ),
                  if (_canEdit)
                    SizedBox(
                      width: double.infinity,
                      height: 48,
                      child: ElevatedButton(
                        onPressed: _saving ? null : _save,
                        child: Text(_saving ? 'Saving…' : 'Save'),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            _imageCard(
              title: 'Profile photo',
              url: me.profilePhotoUrl,
              busy: _uploadingPhoto,
              onUpload: _uploadPhoto,
            ),
            const SizedBox(height: 12),
            _letterheadCard(me),
            if (me.publicSlug.isNotEmpty) ...[
              const SizedBox(height: 12),
              _qrCard(me),
            ],
            if (_canSchedule) ...[
              const SizedBox(height: 12),
              SectionCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const CardTitle('OPD schedule'),
                    const Text(
                      'Set your weekly hours and leave days.',
                      style: TextStyle(
                          color: AppColors.textSecondary, fontSize: 12),
                    ),
                    const SizedBox(height: 12),
                    OutlinedButton.icon(
                      onPressed: () => _openSchedule(me),
                      icon: const Icon(Icons.schedule, size: 16),
                      label: const Text('Manage schedule'),
                    ),
                  ],
                ),
              ),
            ],
          ],
        );
      },
    );
  }

  Widget _letterheadCard(Doctor me) {
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const CardTitle('Prescription letterhead'),
          const Text(
            'This appears at the top of every prescription you issue.',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
          ),
          const SizedBox(height: 12),
          // Clinic / practice name commented out for now as requested
          /*
          LabeledField(
            label: 'Clinic / practice name',
            child: TextField(
              controller: _clinicName,
              enabled: _canEdit,
              decoration: const InputDecoration(hintText: 'Rao Heart Clinic'),
            ),
          ),
          */
          LabeledField(
            label: 'Address',
            child: TextField(
              controller: _clinicAddress,
              enabled: _canEdit,
              maxLines: 2,
              decoration: const InputDecoration(
                  hintText: '2nd Floor, MG Road, Bengaluru 560001'),
            ),
          ),
          LabeledField(
            label: 'Phone',
            child: TextField(
              controller: _clinicPhone,
              enabled: _canEdit,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(hintText: '+91 98765 43210'),
            ),
          ),
          const SizedBox(height: 4),
          // Logo upload row commented out as requested by client design update
          /*
          Row(
            children: [
              if (me.clinicLogoUrl != null && me.clinicLogoUrl!.isNotEmpty)
                ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: Image.network(me.clinicLogoUrl!,
                      width: 52,
                      height: 52,
                      fit: BoxFit.contain,
                      errorBuilder: (_, _, _) => const SizedBox(
                          width: 52, height: 52)),
                )
              else
                Container(
                  width: 52,
                  height: 52,
                  decoration: BoxDecoration(
                    color: AppColors.page,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: AppColors.border, width: 0.5),
                  ),
                  child: const Icon(Icons.image_outlined,
                      color: AppColors.textSecondary, size: 20),
                ),
              const SizedBox(width: 12),
              if (_canEdit)
                OutlinedButton.icon(
                  onPressed: _uploadingLogo ? null : _uploadLogo,
                  icon: const Icon(Icons.upload_file, size: 16),
                  label: Text(_uploadingLogo ? 'Uploading…' : 'Upload logo'),
                ),
            ],
          ),
          */
          const SizedBox(height: 14),
          _letterheadPreview(me),
          if (_canEdit) ...[
            const SizedBox(height: 14),
            SizedBox(
              width: double.infinity,
              height: 48,
              child: ElevatedButton(
                onPressed: _savingLetterhead ? null : _saveLetterhead,
                child: Text(_savingLetterhead ? 'Saving…' : 'Save letterhead'),
              ),
            ),
          ],
        ],
      ),
    );
  }

  /// A faithful mini of the new PDF letterhead layout.
  Widget _letterheadPreview(Doctor me) {
    const accent = Color(0xFF1B6EF3);
    final docName = _name.text.trim().isNotEmpty
        ? (_name.text.trim().toLowerCase().startsWith('dr.')
            ? _name.text.trim()
            : 'Dr. ${_name.text.trim()}')
        : 'Dr. Doctor Name';
    final qualifications = _qualifications.text.trim().isNotEmpty
        ? _qualifications.text.trim()
        : 'M.B.B.S.';
    final specialization = _specialization.text.trim().isNotEmpty
        ? _specialization.text.trim()
        : (_clinicName.text.trim().isNotEmpty ? _clinicName.text.trim() : '');
    final address = _clinicAddress.text.trim().isNotEmpty
        ? _clinicAddress.text.trim()
        : 'Address';
    final phone = _clinicPhone.text.trim();

    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.border, width: 0.5),
      ),
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Top blue bar
          Container(
            height: 3.5,
            width: double.infinity,
            decoration: BoxDecoration(
              color: accent,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          const SizedBox(height: 12),
          // Doctor & Address row
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      docName,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        color: Color(0xFF111827),
                      ),
                    ),
                    if (qualifications.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 2),
                        child: Text(
                          qualifications,
                          style: const TextStyle(
                            fontSize: 10.5,
                            color: Color(0xFF374151),
                          ),
                        ),
                      ),
                    if (specialization.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 1),
                        child: Text(
                          specialization,
                          style: const TextStyle(
                            fontSize: 10,
                            color: Color(0xFF6B7280),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    address,
                    textAlign: TextAlign.right,
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: Color(0xFF111827),
                    ),
                  ),
                  if (phone.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(
                        phone,
                        textAlign: TextAlign.right,
                        style: const TextStyle(
                          fontSize: 10,
                          color: Color(0xFF6B7280),
                        ),
                      ),
                    ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 14),
          const Divider(height: 1, thickness: 0.5, color: Color(0xFFF3F4F6)),
          const SizedBox(height: 10),
          // Patient info row
          const Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Patient Name',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      color: Color(0xFF111827),
                    ),
                  ),
                  SizedBox(height: 1),
                  Text(
                    'Patient Name (Age yrs, Gender)',
                    style: TextStyle(
                      fontSize: 10,
                      color: Color(0xFF374151),
                    ),
                  ),
                ],
              ),
              Text(
                'Date',
                style: TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.w700,
                  color: Color(0xFF111827),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          const Divider(height: 1, thickness: 0.5, color: Color(0xFFF3F4F6)),
          const SizedBox(height: 8),
          const Text(
            'TREATMENT ADVICE',
            style: TextStyle(
              fontSize: 10.5,
              fontWeight: FontWeight.w700,
              color: Color(0xFF111827),
              letterSpacing: 0.3,
            ),
          ),
          const SizedBox(height: 4),
          const Text(
            'Medicines and advice appear here.',
            style: TextStyle(
              fontSize: 9.5,
              fontStyle: FontStyle.italic,
              color: Color(0xFF6B7280),
            ),
          ),
          const SizedBox(height: 16),
          const Divider(height: 1, thickness: 0.5, color: Color(0xFFE5E7EB)),
          const SizedBox(height: 6),
          const Center(
            child: Text(
              '*This is a digitally signed prescription and does not require signature.*',
              style: TextStyle(
                fontSize: 8,
                fontStyle: FontStyle.italic,
                color: Color(0xFF9CA3AF),
              ),
            ),
          ),
          const SizedBox(height: 6),
          Container(
            height: 3.5,
            width: double.infinity,
            decoration: BoxDecoration(
              color: accent,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
        ],
      ),
    );
  }

  Widget _imageCard({
    required String title,
    required String? url,
    required bool busy,
    required VoidCallback onUpload,
  }) {
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          CardTitle(title),
          if (url != null && url.isNotEmpty)
            ClipRRect(
              borderRadius: BorderRadius.circular(AppRadius.control),
              child: Image.network(url,
                  width: double.infinity,
                  height: 180,
                  fit: BoxFit.contain,
                  errorBuilder: (_, _, _) => const Text(
                      'Could not load image.',
                      style: TextStyle(color: AppColors.textSecondary))),
            )
          else
            const Text('Nothing uploaded yet.',
                style: TextStyle(color: AppColors.textSecondary)),
          if (_canEdit) ...[
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: busy ? null : onUpload,
              icon: const Icon(Icons.upload_file, size: 16),
              label: Text(busy ? 'Uploading…' : 'Upload new'),
            ),
          ],
        ],
      ),
    );
  }
}
