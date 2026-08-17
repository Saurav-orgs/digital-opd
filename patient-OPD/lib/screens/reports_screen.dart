import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:url_launcher/url_launcher.dart';
import '../api/api_client.dart';
import '../api/models.dart';
import '../auth/patient_scope.dart';
import '../theme.dart';
import '../widgets/common.dart';

/// Lab reports from the clinic, plus anything the patient uploads themself —
/// self-uploads attach to their most recently booked appointment.
class ReportsScreen extends StatefulWidget {
  const ReportsScreen({super.key});

  @override
  State<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends State<ReportsScreen> {
  Future<List<PatientReport>>? _future;
  bool _uploading = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _future ??= PatientAuthScope.of(context).api.myReports();
  }

  Future<void> _refresh() async {
    setState(() => _future = PatientAuthScope.of(context).api.myReports());
    await _future;
  }

  Future<void> _uploadReport() async {
    final picked = await ImagePicker().pickImage(source: ImageSource.gallery, imageQuality: 85);
    if (picked == null || !mounted) return;

    final title = await showDialog<String>(
      context: context,
      builder: (c) => _TitleDialog(),
    );
    if (title == null || title.trim().isEmpty || !mounted) return;

    setState(() => _uploading = true);
    try {
      await PatientAuthScope.of(context).api.uploadMyReport(title.trim(), File(picked.path));
      if (mounted) {
        showSuccessSnack(context, 'Report uploaded');
        _refresh();
      }
    } on ApiException catch (e) {
      if (mounted) showErrorSnack(context, e.message);
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('My Reports'),
        actions: [
          IconButton(
            tooltip: 'Sign out',
            icon: const Icon(Icons.logout),
            onPressed: () => confirmSignOut(context, () => PatientAuthScope.of(context).logout()),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _uploading ? null : _uploadReport,
        icon: _uploading
            ? const SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2.2, color: Colors.white))
            : const Icon(Icons.add),
        label: Text(_uploading ? 'Uploading…' : 'Upload report'),
      ),
      body: FutureBuilder<List<PatientReport>>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const StateView(loading: true);
          }
          if (snap.hasError) {
            return StateView(error: 'Could not load your reports.', onRetry: _refresh);
          }
          final reports = snap.data ?? [];
          if (reports.isEmpty) {
            return RefreshIndicator(
              onRefresh: _refresh,
              child: ListView(children: const [
                SizedBox(height: 140),
                StateView(empty: 'No reports available yet.'),
              ]),
            );
          }
          return RefreshIndicator(
            onRefresh: _refresh,
            child: ListView.separated(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 88),
              itemCount: reports.length,
              separatorBuilder: (_, _) => const SizedBox(height: 10),
              itemBuilder: (context, i) {
                final r = reports[i];
                return SectionCard(
                  child: InkWell(
                    onTap: r.url == null
                        ? null
                        : () => launchUrl(Uri.parse(r.url!), mode: LaunchMode.externalApplication),
                    child: Row(
                      children: [
                        const Icon(Icons.description_outlined, color: AppColors.primary),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(r.title, style: const TextStyle(fontWeight: FontWeight.w600)),
                              const SizedBox(height: 2),
                              Text(r.createdAt.split('T').first,
                                  style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                            ],
                          ),
                        ),
                        const Icon(Icons.open_in_new, size: 16, color: AppColors.textSecondary),
                      ],
                    ),
                  ),
                );
              },
            ),
          );
        },
      ),
    );
  }
}

class _TitleDialog extends StatefulWidget {
  @override
  State<_TitleDialog> createState() => _TitleDialogState();
}

class _TitleDialogState extends State<_TitleDialog> {
  final _title = TextEditingController();

  @override
  void dispose() {
    _title.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Report title'),
      content: TextField(
        controller: _title,
        autofocus: true,
        decoration: const InputDecoration(hintText: 'e.g. Blood Test — CBC'),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
        TextButton(
          onPressed: () => Navigator.pop(context, _title.text),
          child: const Text('Upload'),
        ),
      ],
    );
  }
}
