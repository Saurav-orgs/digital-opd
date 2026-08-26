import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../api/models.dart';
import '../auth/patient_scope.dart';
import '../doctor_context.dart';
import '../theme.dart';
import '../widgets/common.dart';
import '../widgets/patient_switcher.dart';

/// Lab reports from the clinic, plus anything the patient uploads against a
/// visit. Uploads happen per-visit under My Visits (allowed until the doctor
/// marks that visit done), so this screen only lists reports.
class ReportsScreen extends StatefulWidget {
  const ReportsScreen({super.key});

  @override
  State<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends State<ReportsScreen> {
  Future<List<PatientReport>>? _future;
  String? _loadedFor;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final id = PatientAuthScope.of(context).selectedProfileId;
    if (id != null && id != _loadedFor) {
      _loadedFor = id;
      _future = _load(id);
    }
  }

  Future<List<PatientReport>> _load(String profileId) {
    final doctorId = DoctorContextScope.of(context).doctor?.id;
    return PatientAuthScope.of(context).api.myReports(profileId, doctorId: doctorId);
  }

  Future<void> _refresh() async {
    final id = PatientAuthScope.of(context).selectedProfileId;
    if (id == null) return;
    setState(() => _future = _load(id));
    await _future;
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
      body: RequirePatient(
        builder: (context, patient) => Column(
          children: [
            const PatientSwitcher(),
            Expanded(child: _reports(patient)),
          ],
        ),
      ),
    );
  }

  Widget _reports(PatientProfile patient) {
    return FutureBuilder<List<PatientReport>>(
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
              child: ListView(children: [
                const SizedBox(height: 140),
                StateView(
                    empty:
                        'No reports yet for ${patient.name}. Upload one from a visit under My Visits.'),
              ]),
            );
          }
          return RefreshIndicator(
            onRefresh: _refresh,
            child: ListView.separated(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
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
        });
  }
}
