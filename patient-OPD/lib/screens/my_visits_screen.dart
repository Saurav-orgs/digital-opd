import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../api/models.dart';
import '../auth/patient_scope.dart';
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
    _future ??= PatientAuthScope.of(context).api.myVisits();
  }

  Future<void> _refresh() async {
    setState(() => _future = PatientAuthScope.of(context).api.myVisits());
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
              itemBuilder: (context, i) => _VisitTile(visits[i]),
            ),
          );
        },
      ),
    );
  }
}

class _VisitTile extends StatefulWidget {
  final PatientVisit v;
  const _VisitTile(this.v);

  @override
  State<_VisitTile> createState() => _VisitTileState();
}

class _VisitTileState extends State<_VisitTile> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    final v = widget.v;
    final hasDetails = (v.doctorNotes?.isNotEmpty ?? false) ||
        (v.nextVisitNote?.isNotEmpty ?? false) ||
        v.prescriptions.isNotEmpty ||
        v.reports.isNotEmpty;

    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          InkWell(
            onTap: hasDetails ? () => setState(() => _open = !_open) : null,
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
          if (hasDetails && _open) ...[
            const Divider(height: 24),
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
