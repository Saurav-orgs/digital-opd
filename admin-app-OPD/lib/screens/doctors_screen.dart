import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../api/api_client.dart';
import '../api/models.dart';
import '../auth/auth_scope.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'doctor_schedule_screen.dart';

/// Single-doctor profile: shows the clinic's one doctor with Schedule + Edit
/// actions (no enable/disable). Replaces the old doctors list.
class DoctorProfileScreen extends StatefulWidget {
  const DoctorProfileScreen({super.key});

  @override
  State<DoctorProfileScreen> createState() => _DoctorProfileScreenState();
}

class _DoctorProfileScreenState extends State<DoctorProfileScreen> {
  Future<Doctor?>? _future;

  AuthController get _auth => AuthScope.of(context);

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _future ??= _load();
  }

  Future<Doctor?> _load() async {
    final docs = await _auth.api.listDoctors();
    return docs.isEmpty ? null : docs.first;
  }

  void _reload() => setState(() {
        _future = _load();
      });

  Future<void> _refresh() async {
    _reload();
    await _future;
  }

  Future<void> _openForm(Doctor? doctor) async {
    final saved = await Navigator.push<bool>(
      context,
      MaterialPageRoute(builder: (_) => DoctorFormScreen(doctor: doctor)),
    );
    if (saved == true) _reload();
  }

  void _openSchedule(Doctor d) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) =>
            DoctorScheduleScreen(doctorId: d.id, doctorName: d.name),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final canCreate = _auth.can('doctors', 'create');
    final canUpdate = _auth.can('doctors', 'update');
    final canSchedule = _auth.can('opd_schedules', 'read');

    return Scaffold(
      body: FutureBuilder<Doctor?>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const StateView(loading: true);
          }
          if (snap.hasError) {
            return StateView(
                error: 'Could not load the doctor profile.',
                onRetry: _refresh);
          }
          final d = snap.data;
          if (d == null) {
            return RefreshIndicator(
              onRefresh: _refresh,
              child: ListView(children: [
                const SizedBox(height: 120),
                const StateView(empty: 'No doctor profile set up yet.'),
                if (canCreate)
                  Center(
                    child: Padding(
                      padding: const EdgeInsets.only(top: 16),
                      child: OutlinedButton.icon(
                        onPressed: () => _openForm(null),
                        icon: const Icon(Icons.add, size: 18),
                        label: const Text('Add doctor'),
                      ),
                    ),
                  ),
              ]),
            );
          }
          return RefreshIndicator(
            onRefresh: _refresh,
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                _profileCard(d),
                if (d.paymentQrUrl != null && d.paymentQrUrl!.isNotEmpty) ...[
                  const SizedBox(height: 16),
                  _qrCard(d),
                ],
                if (canSchedule || canUpdate) ...[
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      if (canSchedule)
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: () => _openSchedule(d),
                            icon: const Icon(Icons.schedule, size: 18),
                            label: const Text('Schedule'),
                          ),
                        ),
                      if (canSchedule && canUpdate) const SizedBox(width: 12),
                      if (canUpdate)
                        Expanded(
                          child: ElevatedButton.icon(
                            onPressed: () => _openForm(d),
                            icon: const Icon(Icons.edit_outlined, size: 18),
                            label: const Text('Edit'),
                          ),
                        ),
                    ],
                  ),
                ],
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _profileCard(Doctor d) {
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              NetworkThumb(
                  url: d.profilePhotoUrl, size: 72, fallback: Icons.person),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(d.name,
                        style: const TextStyle(
                            fontWeight: FontWeight.w700, fontSize: 18)),
                    if (d.specialization != null &&
                        d.specialization!.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(d.specialization!,
                          style: const TextStyle(
                              color: AppColors.textSecondary, fontSize: 14)),
                    ],
                    if (d.qualifications != null &&
                        d.qualifications!.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(d.qualifications!,
                          style: const TextStyle(
                              color: AppColors.textSecondary, fontSize: 13)),
                    ],
                    const SizedBox(height: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 9, vertical: 3),
                      decoration: BoxDecoration(
                        color: AppColors.secondaryTint,
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Text('${d.feeLabel} fee',
                          style: const TextStyle(
                              color: AppColors.secondary,
                              fontWeight: FontWeight.w500,
                              fontSize: 12)),
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (d.bio != null && d.bio!.isNotEmpty) ...[
            const Divider(height: 28),
            Text(d.bio!,
                style: const TextStyle(
                    color: AppColors.textSecondary, height: 1.4)),
          ],
        ],
      ),
    );
  }

  Widget _qrCard(Doctor d) {
    return SectionCard(
      child: Row(
        children: [
          NetworkThumb(
              url: d.paymentQrUrl, size: 56, fallback: Icons.qr_code),
          const SizedBox(width: 12),
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Payment QR',
                    style: TextStyle(fontWeight: FontWeight.w500)),
                Text('Shown to patients on the booking screen.',
                    style: TextStyle(
                        color: AppColors.textSecondary, fontSize: 12)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class DoctorFormScreen extends StatefulWidget {
  final Doctor? doctor;
  const DoctorFormScreen({super.key, this.doctor});

  @override
  State<DoctorFormScreen> createState() => _DoctorFormScreenState();
}

class _DoctorFormScreenState extends State<DoctorFormScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _name;
  late final TextEditingController _specialization;
  late final TextEditingController _qualifications;
  late final TextEditingController _fee;
  late final TextEditingController _bio;

  File? _photoFile;
  File? _qrFile;
  bool _saving = false;

  ApiClient get _api => AuthScope.of(context).api;
  Doctor? get _doctor => widget.doctor;

  @override
  void initState() {
    super.initState();
    _name = TextEditingController(text: _doctor?.name ?? '');
    _specialization = TextEditingController(text: _doctor?.specialization ?? '');
    _qualifications = TextEditingController(text: _doctor?.qualifications ?? '');
    _fee = TextEditingController(text: _doctor?.consultationFee ?? '');
    _bio = TextEditingController(text: _doctor?.bio ?? '');
  }

  @override
  void dispose() {
    _name.dispose();
    _specialization.dispose();
    _qualifications.dispose();
    _fee.dispose();
    _bio.dispose();
    super.dispose();
  }

  Future<void> _pick(bool photo) async {
    final picked = await ImagePicker()
        .pickImage(source: ImageSource.gallery, imageQuality: 85);
    if (picked == null) return;
    setState(() {
      if (photo) {
        _photoFile = File(picked.path);
      } else {
        _qrFile = File(picked.path);
      }
    });
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);
    try {
      final body = <String, dynamic>{
        'name': _name.text.trim(),
        'specialization':
            _specialization.text.trim().isEmpty ? null : _specialization.text.trim(),
        'qualifications':
            _qualifications.text.trim().isEmpty ? null : _qualifications.text.trim(),
        'bio': _bio.text.trim().isEmpty ? null : _bio.text.trim(),
        'consultation_fee':
            _fee.text.trim().isEmpty ? null : num.tryParse(_fee.text.trim()),
      };
      // Create/update first to obtain the id the upload endpoints need.
      final saved = _doctor == null
          ? await _api.createDoctor(body)
          : await _api.updateDoctor(_doctor!.id, body);
      if (_photoFile != null) await _api.uploadDoctorPhoto(saved.id, _photoFile!);
      if (_qrFile != null) await _api.uploadDoctorQr(saved.id, _qrFile!);
      if (mounted) {
        showSuccessSnack(
            context, _doctor == null ? 'Doctor created' : 'Doctor updated');
        Navigator.pop(context, true);
      }
    } on ApiException catch (e) {
      if (mounted) showErrorSnack(context, e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(_doctor == null ? 'Add doctor' : 'Edit doctor')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            LabeledField(
              label: 'Name',
              child: TextFormField(
                controller: _name,
                validator: (v) =>
                    (v ?? '').trim().length < 2 ? 'Name is required.' : null,
              ),
            ),
            LabeledField(
              label: 'Specialization',
              child: TextFormField(controller: _specialization),
            ),
            LabeledField(
              label: 'Qualifications',
              child: TextFormField(controller: _qualifications),
            ),
            LabeledField(
              label: 'Consultation fee (₹)',
              child: TextFormField(
                controller: _fee,
                keyboardType: TextInputType.number,
              ),
            ),
            LabeledField(
              label: 'Bio',
              child: TextFormField(controller: _bio, maxLines: 3),
            ),
            const SizedBox(height: 4),
            _imageCard(
              title: 'Profile photo',
              subtitle: 'Shown to patients.',
              current: _doctor?.profilePhotoUrl,
              file: _photoFile,
              onPick: () => _pick(true),
            ),
            const SizedBox(height: 12),
            _imageCard(
              title: 'Payment QR',
              subtitle: 'Shown on the booking screen.',
              current: _doctor?.paymentQrUrl,
              file: _qrFile,
              onPick: () => _pick(false),
            ),
            const SizedBox(height: 20),
            SizedBox(
              height: 50,
              child: ElevatedButton(
                onPressed: _saving ? null : _save,
                child: _saving
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                            strokeWidth: 2.2, color: Colors.white))
                    : const Text('Save'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _imageCard({
    required String title,
    required String subtitle,
    required String? current,
    required File? file,
    required VoidCallback onPick,
  }) {
    Widget preview;
    if (file != null) {
      preview = ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: Image.file(file, width: 56, height: 56, fit: BoxFit.cover),
      );
    } else {
      preview =
          NetworkThumb(url: current, size: 56, fallback: Icons.image_outlined);
    }
    return SectionCard(
      child: Row(
        children: [
          preview,
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title,
                    style: const TextStyle(fontWeight: FontWeight.w500)),
                Text(subtitle,
                    style: const TextStyle(
                        color: AppColors.textSecondary, fontSize: 12)),
              ],
            ),
          ),
          OutlinedButton(
            onPressed: onPick,
            child: Text((file != null || current != null) ? 'Change' : 'Upload'),
          ),
        ],
      ),
    );
  }
}
