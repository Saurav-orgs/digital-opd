import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'package:url_launcher/url_launcher.dart';
import '../api/api_client.dart';
import '../api/models.dart';
import '../auth/auth_scope.dart';
import '../theme.dart';
import '../widgets/common.dart';

/// Upload + view patient reports by mobile number. For a pathlab login
/// (whose role only holds reports:create/read) this is the entire app.
class ReportsScreen extends StatefulWidget {
  const ReportsScreen({super.key});

  @override
  State<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends State<ReportsScreen> {
  final _mobile = TextEditingController();
  final _title = TextEditingController();
  String? _searched;
  File? _file;
  bool _uploading = false;

  Future<List<PatientReport>>? _future;

  AuthController get _auth => AuthScope.of(context);
  bool get _mobileValid => RegExp(r'^[6-9]\d{9}$').hasMatch(_mobile.text.trim());

  @override
  void dispose() {
    _mobile.dispose();
    _title.dispose();
    super.dispose();
  }

  void _search() {
    if (!_mobileValid) return;
    setState(() {
      _searched = _mobile.text.trim();
      _future = _auth.api.listReports(_searched!);
    });
  }

  Future<void> _pickFile() async {
    final picked = await ImagePicker().pickImage(source: ImageSource.gallery, imageQuality: 85);
    if (picked != null) setState(() => _file = File(picked.path));
  }

  Future<void> _upload() async {
    if (_searched == null || _file == null || _title.text.trim().isEmpty) return;
    setState(() => _uploading = true);
    try {
      await _auth.api.uploadReport(_searched!, _title.text.trim(), _file!);
      if (mounted) showSuccessSnack(context, 'Report uploaded');
      setState(() {
        _title.clear();
        _file = null;
        _future = _auth.api.listReports(_searched!);
      });
    } on ApiException catch (e) {
      if (mounted) showErrorSnack(context, e.message);
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Future<void> _delete(PatientReport r) async {
    try {
      await _auth.api.removeReport(r.id);
      if (mounted) showSuccessSnack(context, 'Report deleted');
      setState(() => _future = _auth.api.listReports(_searched!));
    } on ApiException catch (e) {
      if (mounted) showErrorSnack(context, e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final canCreate = _auth.can('reports', 'create');
    final canRead = _auth.can('reports', 'read');

    return Scaffold(
      appBar: AppBar(title: const Text('Reports')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          SectionCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const CardTitle('Look up a patient'),
                TextField(
                  controller: _mobile,
                  keyboardType: TextInputType.phone,
                  inputFormatters: [
                    FilteringTextInputFormatter.digitsOnly,
                    LengthLimitingTextInputFormatter(10),
                  ],
                  onChanged: (_) => setState(() {}),
                  decoration: const InputDecoration(labelText: 'Patient mobile number'),
                ),
                const SizedBox(height: 10),
                OutlinedButton(
                  onPressed: _mobileValid ? _search : null,
                  child: const Text('Look up reports'),
                ),
              ],
            ),
          ),
          if (_searched != null && canCreate) ...[
            const SizedBox(height: 16),
            SectionCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  CardTitle('Upload a report for $_searched'),
                  TextField(
                    controller: _title,
                    decoration: const InputDecoration(labelText: 'Report title'),
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: _pickFile,
                          icon: const Icon(Icons.attach_file, size: 16),
                          label: Text(_file == null ? 'Choose file' : 'File selected'),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  SizedBox(
                    height: 46,
                    child: ElevatedButton(
                      onPressed: (_uploading || _file == null || _title.text.trim().isEmpty)
                          ? null
                          : _upload,
                      child: _uploading
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                          : const Text('Upload report'),
                    ),
                  ),
                  const SizedBox(height: 6),
                  const Text('JPG, PNG, WebP or PDF · up to 5 MB.',
                      style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                ],
              ),
            ),
          ],
          if (_searched != null && canRead) ...[
            const SizedBox(height: 16),
            SectionCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  CardTitle('Reports for $_searched'),
                  FutureBuilder<List<PatientReport>>(
                    future: _future,
                    builder: (context, snap) {
                      if (snap.connectionState == ConnectionState.waiting) {
                        return const Padding(
                          padding: EdgeInsets.symmetric(vertical: 8),
                          child: Text('Loading…', style: TextStyle(color: AppColors.textSecondary)),
                        );
                      }
                      final list = snap.data ?? [];
                      if (list.isEmpty) {
                        return const Text('No reports uploaded yet.',
                            style: TextStyle(color: AppColors.textSecondary));
                      }
                      return Column(
                        children: list.map((r) {
                          return ListTile(
                            contentPadding: EdgeInsets.zero,
                            leading: const Icon(Icons.description_outlined, color: AppColors.primary),
                            title: Text(r.title),
                            subtitle: Text(r.createdAt.split('T').first),
                            onTap: r.url == null
                                ? null
                                : () => launchUrl(Uri.parse(r.url!), mode: LaunchMode.externalApplication),
                            trailing: canCreate
                                ? IconButton(
                                    icon: const Icon(Icons.delete_outline, color: AppColors.error),
                                    onPressed: () => _delete(r),
                                  )
                                : null,
                          );
                        }).toList(),
                      );
                    },
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}
