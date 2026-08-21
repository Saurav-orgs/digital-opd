import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:url_launcher/url_launcher.dart';
import '../api/api_client.dart';
import '../api/models.dart';
import '../auth/patient_scope.dart';
import '../doctor_context.dart';
import '../theme.dart';
import '../widgets/common.dart';

/// Consultation history — doctor's notes, next-visit reminders and
/// prescriptions from each visit, matched by the patient's mobile number.
class MyVisitsScreen extends StatefulWidget {
  const MyVisitsScreen({super.key});

  @override
  State<MyVisitsScreen> createState() => _MyVisitsScreenState();
}

class _MyVisitsScreenState extends State<MyVisitsScreen> {
  Future<List<PatientVisit>>? _future;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final doctorId = DoctorContextScope.of(context).doctor?.id;
    _future ??= PatientAuthScope.of(context).api.myVisits(doctorId: doctorId);
  }

  Future<void> _refresh() async {
    final doctorId = DoctorContextScope.of(context).doctor?.id;
    setState(() => _future =
        PatientAuthScope.of(context).api.myVisits(doctorId: doctorId));
    await _future;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('My Visits'),
        actions: [
          IconButton(
            tooltip: 'Sign out',
            icon: const Icon(Icons.logout),
            onPressed: () => confirmSignOut(context, () => PatientAuthScope.of(context).logout()),
          ),
        ],
      ),
      body: FutureBuilder<List<PatientVisit>>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const StateView(loading: true);
          }
          if (snap.hasError) {
            return StateView(error: 'Could not load your visits.', onRetry: _refresh);
          }
          final visits = snap.data ?? [];
          if (visits.isEmpty) {
            return RefreshIndicator(
              onRefresh: _refresh,
              child: ListView(children: const [
                SizedBox(height: 140),
                StateView(
                    empty:
                        'No visits yet. Once you book an OPD appointment, it will show up here.'),
              ]),
            );
          }
          return RefreshIndicator(
            onRefresh: _refresh,
            child: ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: visits.length,
              separatorBuilder: (_, _) => const SizedBox(height: 10),
              itemBuilder: (context, i) =>
                  _VisitTile(visits[i], onChanged: _refresh),
            ),
          );
        },
      ),
    );
  }
}

class _VisitTile extends StatefulWidget {
  final PatientVisit v;
  final Future<void> Function() onChanged;
  const _VisitTile(this.v, {required this.onChanged});

  @override
  State<_VisitTile> createState() => _VisitTileState();
}

class _VisitTileState extends State<_VisitTile> {
  bool _open = false;
  bool _uploading = false;

  Future<void> _uploadReport() async {
    final picked = await ImagePicker()
        .pickImage(source: ImageSource.gallery, imageQuality: 85);
    if (picked == null || !mounted) return;

    final title = await showDialog<String>(
      context: context,
      builder: (_) => _TitleDialog(),
    );
    if (title == null || title.trim().isEmpty || !mounted) return;

    setState(() => _uploading = true);
    try {
      await PatientAuthScope.of(context)
          .api
          .uploadVisitReport(widget.v.id, title.trim(), File(picked.path));
      if (mounted) {
        showSuccessSnack(context, 'Report uploaded');
        await widget.onChanged();
      }
    } on ApiException catch (e) {
      if (mounted) showErrorSnack(context, e.message);
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final v = widget.v;
    final expandable = (v.doctorNotes?.isNotEmpty ?? false) ||
        (v.nextVisitNote?.isNotEmpty ?? false) ||
        v.ePrescription != null ||
        v.prescriptions.isNotEmpty ||
        v.reports.isNotEmpty ||
        v.acceptsReports;

    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          InkWell(
            onTap: expandable ? () => setState(() => _open = !_open) : null,
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('${v.appointmentDate} · ${v.startTime}',
                          style: const TextStyle(fontWeight: FontWeight.w600)),
                      if (v.doctorName != null) ...[
                        const SizedBox(height: 4),
                        Text(
                          v.doctorSpecialization != null
                              ? '${v.doctorName} · ${v.doctorSpecialization}'
                              : v.doctorName!,
                          style: const TextStyle(color: AppColors.textSecondary, fontSize: 13),
                        ),
                      ],
                    ],
                  ),
                ),
                StatusBadge(v.status == 'rejected' ? 'rejected' : v.consultationStatus),
              ],
            ),
          ),
          if (expandable && _open) ...[
            const Divider(height: 24),
            if (v.ePrescription != null) ...[
              _PrescriptionCard(v.ePrescription!),
              const SizedBox(height: 12),
            ],
            if (v.description != null && v.description!.isNotEmpty)
              _line('Reason', v.description!),
            if (v.doctorNotes != null && v.doctorNotes!.isNotEmpty)
              _line("Doctor's note", v.doctorNotes!),
            if (v.nextVisitNote != null && v.nextVisitNote!.isNotEmpty) ...[
              const SizedBox(height: 4),
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: AppColors.primaryTint,
                  borderRadius: BorderRadius.circular(AppRadius.control),
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(Icons.notifications_active_outlined, size: 16, color: AppColors.primary),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(v.nextVisitNote!, style: const TextStyle(fontSize: 13)),
                          if (v.nextVisitDate != null) ...[
                            const SizedBox(height: 2),
                            Text('Suggested date: ${v.nextVisitDate}',
                                style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                          ],
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ],
            if (v.prescriptions.isNotEmpty) ...[
              const SizedBox(height: 10),
              const Text('Prescriptions', style: TextStyle(fontSize: 12, color: AppColors.textSecondary)),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: v.prescriptions
                    .map((p) => ClipRRect(
                          borderRadius: BorderRadius.circular(AppRadius.control),
                          child: p.url == null
                              ? Container(width: 64, height: 64, color: AppColors.page)
                              : Image.network(p.url!, width: 64, height: 64, fit: BoxFit.cover),
                        ))
                    .toList(),
              ),
            ],
            if (v.reports.isNotEmpty) ...[
              const SizedBox(height: 10),
              const Text('Reports', style: TextStyle(fontSize: 12, color: AppColors.textSecondary)),
              const SizedBox(height: 6),
              ...v.reports.map((r) => Padding(
                    padding: const EdgeInsets.only(bottom: 4),
                    child: InkWell(
                      onTap: r.url == null
                          ? null
                          : () => launchUrl(Uri.parse(r.url!), mode: LaunchMode.externalApplication),
                      child: Text('📄 ${r.title}',
                          style: const TextStyle(color: AppColors.primary, fontSize: 13)),
                    ),
                  )),
            ],
            if (v.acceptsReports) ...[
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: _uploading ? null : _uploadReport,
                  icon: _uploading
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2.2))
                      : const Icon(Icons.upload_file, size: 16),
                  label: Text(_uploading ? 'Uploading…' : 'Upload a report'),
                ),
              ),
              const SizedBox(height: 4),
              const Text(
                  'You can add reports until the doctor marks this visit done.',
                  style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
            ],
          ],
        ],
      ),
    );
  }

  Widget _line(String label, String value) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: RichText(
          text: TextSpan(
            style: const TextStyle(color: AppColors.text, fontSize: 13),
            children: [
              TextSpan(text: '$label: ', style: const TextStyle(color: AppColors.textSecondary)),
              TextSpan(text: value),
            ],
          ),
        ),
      );
}

/// The doctor's issued e-prescription, with a link to the printable PDF.
class _PrescriptionCard extends StatelessWidget {
  final IssuedPrescription p;
  const _PrescriptionCard(this.p);

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.primaryTint,
        borderRadius: BorderRadius.circular(AppRadius.control),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.medication_outlined,
                  size: 18, color: AppColors.primary),
              const SizedBox(width: 6),
              const Text('Prescription',
                  style: TextStyle(fontWeight: FontWeight.w700)),
              const Spacer(),
              if (p.pdfUrl != null && p.pdfUrl!.isNotEmpty)
                TextButton.icon(
                  onPressed: () => launchUrl(Uri.parse(p.pdfUrl!),
                      mode: LaunchMode.externalApplication),
                  icon: const Icon(Icons.download_outlined, size: 16),
                  label: const Text('PDF'),
                  style: TextButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                    minimumSize: const Size(0, 32),
                  ),
                ),
            ],
          ),
          if (p.diagnosis != null && p.diagnosis!.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text('Diagnosis: ${p.diagnosis}',
                style: const TextStyle(fontSize: 13)),
          ],
          if (p.medicines.isNotEmpty) ...[
            const SizedBox(height: 10),
            ...p.medicines.asMap().entries.map((e) {
              final m = e.value;
              final title = [m.medicineName, m.strength]
                  .where((x) => x != null && x.isNotEmpty)
                  .join(' ');
              return Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('${e.key + 1}. $title',
                        style: const TextStyle(
                            fontWeight: FontWeight.w600, fontSize: 13.5)),
                    if (m.scheduleLabel.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(left: 14, top: 2),
                        child: Text(m.scheduleLabel,
                            style: const TextStyle(
                                color: AppColors.textSecondary, fontSize: 12.5)),
                      ),
                    if (m.instructions != null && m.instructions!.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(left: 14, top: 2),
                        child: Text(m.instructions!,
                            style: const TextStyle(
                                color: AppColors.textSecondary,
                                fontSize: 12,
                                fontStyle: FontStyle.italic)),
                      ),
                  ],
                ),
              );
            }),
          ],
          if (p.advice != null && p.advice!.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text('Advice: ${p.advice}', style: const TextStyle(fontSize: 13)),
          ],
          if (p.followUpDate != null && p.followUpDate!.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text('Follow-up on ${p.followUpDate}',
                style: const TextStyle(
                    color: AppColors.textSecondary, fontSize: 12.5)),
          ],
        ],
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
