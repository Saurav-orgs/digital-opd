import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../api/api_client.dart';
import '../api/models.dart';
import '../auth/auth_scope.dart';
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
  final _fee = TextEditingController();
  final _bio = TextEditingController();

  bool _hydrated = false;
  bool _saving = false;
  bool _uploadingPhoto = false;

  AuthController get _auth => AuthScope.of(context);
  bool get _canEdit => _auth.can('doctors', 'update');
  bool get _canSchedule => _auth.can('opd_schedules', 'read');

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _future ??= _load();
  }

  Future<Doctor> _load() async {
    final me = await _auth.api.getMe();
    if (!_hydrated) {
      _name.text = me.name;
      _specialization.text = me.specialization ?? '';
      _qualifications.text = me.qualifications ?? '';
      _fee.text = me.consultationFee ?? '';
      _bio.text = me.bio ?? '';
      _hydrated = true;
    }
    return me;
  }

  void _reload() => setState(() { _future = _load(); });

  @override
  void dispose() {
    _name.dispose();
    _specialization.dispose();
    _qualifications.dispose();
    _fee.dispose();
    _bio.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await _auth.api.updateMe({
        'name': _name.text.trim(),
        'specialization':
            _specialization.text.trim().isEmpty ? null : _specialization.text.trim(),
        'qualifications':
            _qualifications.text.trim().isEmpty ? null : _qualifications.text.trim(),
        'bio': _bio.text.trim().isEmpty ? null : _bio.text.trim(),
        'consultation_fee':
            _fee.text.trim().isEmpty ? null : num.tryParse(_fee.text.trim()),
      });
      if (mounted) showSuccessSnack(context, 'Profile updated');
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

  void _openSchedule(Doctor me) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) =>
            DoctorScheduleScreen(doctorId: me.id, doctorName: me.name),
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
