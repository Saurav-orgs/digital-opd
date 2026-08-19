import 'dart:async';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:url_launcher/url_launcher.dart';
import '../api/api_client.dart';
import '../api/models.dart';
import '../auth/auth_scope.dart';
import '../theme.dart';
import '../widgets/common.dart';
import '../widgets/consultation_panel.dart';
import '../widgets/slot_selector.dart';

class AppointmentsScreen extends StatefulWidget {
  const AppointmentsScreen({super.key});

  @override
  State<AppointmentsScreen> createState() => _AppointmentsScreenState();
}

class _AppointmentsScreenState extends State<AppointmentsScreen> {
  String? _doctorId;
  String? _date;
  String? _status;
  String? _search;

  final _searchController = TextEditingController();
  Timer? _debounce;

  Future<List<Appointment>>? _future;
  List<Doctor> _doctors = [];

  AuthController get _auth => AuthScope.of(context);

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _future ??= _load();
    _maybeLoadDoctors();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  // Debounce the free-text search so we don't refetch on every keystroke.
  // Rebuild immediately so the clear (×) affordance tracks the field.
  void _onSearchChanged(String value) {
    setState(() {});
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () {
      final q = value.trim();
      final next = q.isEmpty ? null : q;
      if (next != _search) {
        _search = next;
        _apply();
      }
    });
  }

  Future<void> _maybeLoadDoctors() async {
    if (_doctors.isNotEmpty) return;
    if (_auth.user?.isDoctor ?? false) return; // doctors are auto-scoped
    if (!_auth.can('doctors', 'read')) return;
    try {
      final docs = await _auth.api.listDoctors();
      if (mounted) setState(() => _doctors = docs);
    } catch (_) {/* filter is optional */}
  }

  Future<List<Appointment>> _load() => _auth.api.listAppointments(
        doctorId: _doctorId,
        date: _date,
        status: _status,
        search: _search,
      );

  void _apply() => setState(() { _future = _load(); });

  Future<void> _refresh() async {
    _apply();
    await _future;
  }

  void _clear() {
    _debounce?.cancel();
    _searchController.clear();
    setState(() {
      _doctorId = null;
      _date = null;
      _status = null;
      _search = null;
      _future = _load();
    });
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: now,
      firstDate: DateTime(now.year - 1),
      lastDate: DateTime(now.year + 1),
    );
    if (picked != null) {
      _date =
          '${picked.year.toString().padLeft(4, '0')}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}';
      _apply();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        _filters(),
        Expanded(
          child: FutureBuilder<List<Appointment>>(
            future: _future,
            builder: (context, snap) {
              if (snap.connectionState == ConnectionState.waiting) {
                return const StateView(loading: true);
              }
              if (snap.hasError) {
                return StateView(
                    error: 'Could not load appointments.', onRetry: _refresh);
              }
              final list = snap.data ?? [];
              if (list.isEmpty) {
                return RefreshIndicator(
                  onRefresh: _refresh,
                  child: ListView(
                    children: const [
                      SizedBox(height: 120),
                      StateView(empty: 'No appointments match these filters.'),
                    ],
                  ),
                );
              }
              return RefreshIndicator(
                onRefresh: _refresh,
                child: ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: list.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 10),
                  itemBuilder: (context, i) =>
                      _AppointmentTile(list[i], onChanged: _apply),
                ),
              );
            },
          ),
        ),
      ],
    );
  }

  Widget _filters() {
    final showDoctor =
        !(_auth.user?.isDoctor ?? false) && _doctors.isNotEmpty;
    return Container(
      color: AppColors.card,
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      child: Column(
        children: [
          TextField(
            controller: _searchController,
            onChanged: _onSearchChanged,
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(
              hintText: 'Search name or phone…',
              prefixIcon: const Icon(Icons.search, size: 20),
              isDense: true,
              suffixIcon: _searchController.text.isEmpty
                  ? null
                  : IconButton(
                      icon: const Icon(Icons.close, size: 18),
                      onPressed: () {
                        _debounce?.cancel();
                        _searchController.clear();
                        if (_search != null) {
                          _search = null;
                          _apply();
                        } else {
                          setState(() {});
                        }
                      },
                    ),
            ),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _pickDate,
                  icon: const Icon(Icons.calendar_today_outlined, size: 16),
                  label: Text(_date ?? 'Any date',
                      overflow: TextOverflow.ellipsis),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: DropdownButtonFormField<String>(
                  initialValue: _status,
                  isExpanded: true,
                  decoration: const InputDecoration(
                      contentPadding:
                          EdgeInsets.symmetric(horizontal: 12, vertical: 10)),
                  hint: const Text('Any status'),
                  items: const [
                    DropdownMenuItem(value: null, child: Text('Any status')),
                    DropdownMenuItem(
                        value: 'confirmed', child: Text('Confirmed')),
                    DropdownMenuItem(
                        value: 'rejected', child: Text('Rejected')),
                  ],
                  onChanged: (v) {
                    _status = v;
                    _apply();
                  },
                ),
              ),
            ],
          ),
          if (showDoctor) ...[
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: DropdownButtonFormField<String>(
                    initialValue: _doctorId,
                    isExpanded: true,
                    decoration: const InputDecoration(
                        contentPadding: EdgeInsets.symmetric(
                            horizontal: 12, vertical: 10)),
                    hint: const Text('All doctors'),
                    items: [
                      const DropdownMenuItem(
                          value: null, child: Text('All doctors')),
                      ..._doctors.map((d) => DropdownMenuItem(
                          value: d.id, child: Text(d.name))),
                    ],
                    onChanged: (v) {
                      _doctorId = v;
                      _apply();
                    },
                  ),
                ),
                const SizedBox(width: 10),
                TextButton(onPressed: _clear, child: const Text('Clear')),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _AppointmentTile extends StatelessWidget {
  final Appointment a;
  final VoidCallback onChanged;
  const _AppointmentTile(this.a, {required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(AppRadius.card),
      onTap: () async {
        final changed = await Navigator.push<bool>(
          context,
          MaterialPageRoute(
              builder: (_) => AppointmentDetailScreen(id: a.id)),
        );
        if (changed == true) onChanged();
      },
      child: SectionCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(a.patientName,
                      style: const TextStyle(fontWeight: FontWeight.w600)),
                ),
                Text('${a.appointmentDate} · ${a.startTime}',
                    style: const TextStyle(
                        color: AppColors.textSecondary, fontSize: 12)),
              ],
            ),
            const SizedBox(height: 4),
            Text(a.patientMobile,
                style: const TextStyle(
                    color: AppColors.textSecondary, fontSize: 13)),
            if (a.doctor != null)
              Text(a.doctor!.name,
                  style: const TextStyle(
                      color: AppColors.textSecondary, fontSize: 13)),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 6,
              children: [
                StatusBadge(a.consultationStatus),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class AppointmentDetailScreen extends StatefulWidget {
  final String id;
  const AppointmentDetailScreen({super.key, required this.id});

  @override
  State<AppointmentDetailScreen> createState() =>
      _AppointmentDetailScreenState();
}

class _AppointmentDetailScreenState extends State<AppointmentDetailScreen> {
  late Future<Appointment> _future;
  bool _changed = false;
  bool _busy = false;

  final _notes = TextEditingController();
  bool _notesSeeded = false;

  bool _addingReminder = false;
  final _reminderMsg = TextEditingController();
  String? _reminderDate;

  // Prior visits for this patient (by mobile), loaded once the visit resolves.
  Future<List<Appointment>>? _history;

  ApiClient get _api => AuthScope.of(context).api;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _future = _api.getAppointment(widget.id);
  }

  @override
  void dispose() {
    _notes.dispose();
    _reminderMsg.dispose();
    super.dispose();
  }

  Future<void> _run(Future<Appointment> Function() action, String ok) async {
    setState(() => _busy = true);
    try {
      await action();
      _changed = true;
      setState(() { _future = _api.getAppointment(widget.id); });
      if (mounted) showSuccessSnack(context, ok);
    } on ApiException catch (e) {
      if (mounted) showErrorSnack(context, e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final canUpdate = AuthScope.of(context).can('appointments', 'update');
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) Navigator.pop(context, _changed);
      },
      child: Scaffold(
        appBar: AppBar(title: const Text('Appointment')),
        body: FutureBuilder<Appointment>(
          future: _future,
          builder: (context, snap) {
            if (snap.connectionState == ConnectionState.waiting) {
              return const StateView(loading: true);
            }
            if (snap.hasError) {
              return const StateView(error: 'Could not load this appointment.');
            }
            final a = snap.data!;
            // Seed the note editor once from the loaded appointment.
            if (!_notesSeeded) {
              _notes.text = a.doctorNotes ?? '';
              _notesSeeded = true;
            }
            // Load this patient's prior visits once (matched by mobile).
            _history ??=
                _api.appointmentHistory(a.patientMobile, excludeId: a.id);
            return ListView(
              padding: const EdgeInsets.all(16),
              children: [
                SectionCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _row('Patient', a.patientName),
                      _row('Mobile', a.patientMobile),
                      if (a.patientGender != null || a.patientAge != null)
                        _row('Gender & age', _genderAge(a)),
                      _row('Date & time',
                          '${a.appointmentDate} · ${a.startTime}–${a.endTime}'),
                      _row('Doctor', a.doctor?.name ?? '—'),
                      if (a.patientAddress != null &&
                          a.patientAddress!.isNotEmpty)
                        _row('Address', a.patientAddress!),
                      if (a.description != null && a.description!.isNotEmpty)
                        _row('Reason', a.description!),
                      const SizedBox(height: 10),
                      Wrap(
                        spacing: 8,
                        runSpacing: 6,
                        children: [
                          if (a.isWalkIn)
                            const StatusBadge('walk_in', label: 'Walk-in'),
                          StatusBadge(a.status),
                          StatusBadge(a.consultationStatus),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                _notesCard(a, canUpdate),
                const SizedBox(height: 16),
                _prescriptionsCard(a, canUpdate),
                const SizedBox(height: 16),
                _historyCard(a),
                if (canUpdate && a.status != 'rejected') ...[
                  const SizedBox(height: 16),
                  _rescheduleCard(a),
                ],
                if (canUpdate) ...[
                  const SizedBox(height: 16),
                  _reminderCard(a),
                ],
                const SizedBox(height: 16),
                _reportsCard(a),
                const SizedBox(height: 16),
                ConsultationPanel(
                  appointmentId: widget.id,
                  canEdit: canUpdate && a.status != 'rejected',
                ),
                if (canUpdate) ...[
                  const SizedBox(height: 16),
                  _reviewCard(a),
                ],
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _notesCard(Appointment a, bool canUpdate) {
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const CardTitle('Doctor’s note'),
          const Text(
            'Shown when this patient books their next OPD.',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
          ),
          const SizedBox(height: 10),
          if (canUpdate) ...[
            TextField(
              controller: _notes,
              minLines: 3,
              maxLines: 6,
              maxLength: 2000,
              decoration: const InputDecoration(
                hintText: 'Add a note for this patient’s next visit…',
              ),
            ),
            Align(
              alignment: Alignment.centerRight,
              child: ElevatedButton(
                onPressed: _busy
                    ? null
                    : () => _run(() => _api.setNotes(a.id, _notes.text.trim()),
                        'Note saved'),
                child: const Text('Save note'),
              ),
            ),
          ] else
            Text(
              (a.doctorNotes != null && a.doctorNotes!.isNotEmpty)
                  ? a.doctorNotes!
                  : 'No note yet.',
              style: TextStyle(
                color: (a.doctorNotes != null && a.doctorNotes!.isNotEmpty)
                    ? AppColors.text
                    : AppColors.textSecondary,
              ),
            ),
        ],
      ),
    );
  }

  Widget _reviewCard(Appointment a) {
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const CardTitle('Consultation outcome'),
          Wrap(
            spacing: 10,
            runSpacing: 8,
            children: [
              OutlinedButton(
                onPressed: _busy
                    ? null
                    : () => _run(() => _api.setConsultation(a.id, 'done'),
                        'Marked as done'),
                child: const Text('Done'),
              ),
              OutlinedButton(
                onPressed: _busy
                    ? null
                    : () => _run(() => _api.setConsultation(a.id, 'on_hold'),
                        'Put on hold'),
                child: const Text('On hold'),
              ),
              OutlinedButton(
                onPressed: _busy
                    ? null
                    : () => _run(() => _api.setConsultation(a.id, 'rejected'),
                        'Consultation rejected'),
                style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.error,
                    side: const BorderSide(color: AppColors.error, width: 0.8)),
                child: const Text('Reject'),
              ),
            ],
          ),
        ],
      ),
    );
  }

  String _genderAge(Appointment a) {
    final g = a.patientGender;
    final gender =
        (g == null || g.isEmpty) ? null : g[0].toUpperCase() + g.substring(1);
    final age = a.patientAge == null ? null : '${a.patientAge} yrs';
    return [gender, age].where((e) => e != null).join(' · ');
  }

  // ── Reschedule ─────────────────────────────────────────────
  Future<void> _reschedule(Appointment a) async {
    final result = await Navigator.push<(String, String)>(
      context,
      MaterialPageRoute(
        builder: (_) => _RescheduleScreen(api: _api, doctorId: a.doctorId),
      ),
    );
    if (result == null) return;
    final (date, start) = result;
    await _run(
        () => _api.reschedule(a.id, date, start), 'Appointment rescheduled');
  }

  Widget _rescheduleCard(Appointment a) {
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const CardTitle('Reschedule'),
          const Text('Move this appointment to another available slot.',
              style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
          const SizedBox(height: 12),
          Align(
            alignment: Alignment.centerLeft,
            child: OutlinedButton.icon(
              onPressed: _busy ? null : () => _reschedule(a),
              icon: const Icon(Icons.event_repeat, size: 18),
              label: const Text('Reschedule slot'),
            ),
          ),
        ],
      ),
    );
  }

  // ── Next-visit reminder ──────────────────────────────────────
  Future<void> _sendReminder(Appointment a) async {
    await _run(
      () => _api.addReminder(a.id, _reminderMsg.text.trim(), _reminderDate),
      'Reminder sent to the patient',
    );
    setState(() {
      _addingReminder = false;
      _reminderMsg.clear();
      _reminderDate = null;
    });
  }

  Future<void> _pickReminderDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: now,
      firstDate: now,
      lastDate: now.add(const Duration(days: 365)),
    );
    if (picked != null) {
      setState(() =>
          _reminderDate = '${picked.year.toString().padLeft(4, '0')}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}');
    }
  }

  Widget _reminderCard(Appointment a) {
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const CardTitle('Next-visit reminder'),
          if (a.nextVisitNote != null && a.nextVisitNote!.isNotEmpty && !_addingReminder) ...[
            Text(a.nextVisitNote!, style: const TextStyle(fontSize: 14)),
            if (a.nextVisitDate != null) ...[
              const SizedBox(height: 2),
              Text('Suggested date: ${a.nextVisitDate}',
                  style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
            ],
            const SizedBox(height: 10),
          ],
          if (!_addingReminder)
            OutlinedButton.icon(
              onPressed: _busy ? null : () => setState(() => _addingReminder = true),
              icon: const Icon(Icons.notifications_active_outlined, size: 18),
              label: Text((a.nextVisitNote?.isNotEmpty ?? false) ? 'Update reminder' : 'Add reminder'),
            )
          else ...[
            TextField(
              controller: _reminderMsg,
              minLines: 2,
              maxLines: 4,
              onChanged: (_) => setState(() {}),
              decoration: const InputDecoration(
                  hintText: 'e.g. Please come back for a follow-up in 2 weeks.'),
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                OutlinedButton.icon(
                  onPressed: _pickReminderDate,
                  icon: const Icon(Icons.calendar_today_outlined, size: 16),
                  label: Text(_reminderDate ?? 'Suggested date (optional)'),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                ElevatedButton(
                  onPressed: (_busy || _reminderMsg.text.trim().isEmpty)
                      ? null
                      : () => _sendReminder(a),
                  child: const Text('Send reminder'),
                ),
                const SizedBox(width: 10),
                TextButton(
                  onPressed: () => setState(() {
                    _addingReminder = false;
                    _reminderMsg.clear();
                    _reminderDate = null;
                  }),
                  child: const Text('Cancel'),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  // ── Reports (pathlab-uploaded or patient self-uploaded) ─────
  /// AI summary under a report. `pending` means queued (usually the AI service
  /// isn't up) — saying "summarising" there would promise work that isn't
  /// happening, so the two states read differently.
  Widget _reportSummary(PatientReport r) {
    if (r.summaryStatus == 'processing') {
      return const Padding(
        padding: EdgeInsets.only(top: 4, left: 24),
        child: Text('Summarising…',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 12.5)),
      );
    }
    if (r.summaryStatus == 'pending' || r.summaryStatus == 'failed') {
      return Padding(
        padding: const EdgeInsets.only(top: 4, left: 24),
        child: Row(
          children: [
            Text(
              r.summaryStatus == 'pending'
                  ? 'Waiting to be summarised.'
                  : 'Couldn’t summarise this report.',
              style: const TextStyle(
                  color: AppColors.textSecondary, fontSize: 12.5),
            ),
            TextButton(
              onPressed: () async {
                try {
                  await _api.retryReportSummary(r.id);
                  if (mounted) {
                    showSuccessSnack(context, 'Summarising again…');
                    setState(() {
                      _future = _api.getAppointment(widget.id);
                    });
                  }
                } on ApiException catch (e) {
                  if (mounted) showErrorSnack(context, e.message);
                }
              },
              style: TextButton.styleFrom(
                padding: const EdgeInsets.symmetric(horizontal: 8),
                minimumSize: const Size(0, 30),
              ),
              child: const Text('Summarise now'),
            ),
          ],
        ),
      );
    }

    final summary = r.aiSummary;
    if (summary == null) return const SizedBox.shrink();

    return Container(
      margin: const EdgeInsets.only(top: 6, left: 24),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppColors.page,
        borderRadius: BorderRadius.circular(AppRadius.control),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (summary.reportType.isNotEmpty)
            Text(summary.reportType,
                style: const TextStyle(
                    fontWeight: FontWeight.w600, fontSize: 12.5)),
          Text(summary.summary, style: const TextStyle(fontSize: 13)),
          if (summary.abnormalValues.isNotEmpty) ...[
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: summary.abnormalValues
                  .map((v) => Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 8, vertical: 3),
                        decoration: BoxDecoration(
                          color: v.direction == 'high'
                              ? AppColors.errorTint
                              : AppColors.onHoldTint,
                          borderRadius: BorderRadius.circular(999),
                        ),
                        child: Text('${v.label}: ${v.value}',
                            style: TextStyle(
                                fontSize: 11.5,
                                color: v.direction == 'high'
                                    ? AppColors.error
                                    : AppColors.onHold)),
                      ))
                  .toList(),
            ),
          ],
          if (summary.keyFindings.isNotEmpty) ...[
            const SizedBox(height: 6),
            ...summary.keyFindings.map((f) => Text('• $f',
                style: const TextStyle(fontSize: 12.5))),
          ],
          const SizedBox(height: 6),
          const Text(
            'AI-generated — check the report itself before acting.',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 11),
          ),
        ],
      ),
    );
  }

  Widget _reportsCard(Appointment a) {
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const CardTitle('Reports for this visit'),
          if (a.reports.isEmpty)
            const Text('No reports uploaded for this appointment.',
                style: TextStyle(color: AppColors.textSecondary))
          else ...[
            _visitSummary(a),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: a.reports
                  .map((r) => Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            InkWell(
                              onTap: r.url == null
                                  ? null
                                  : () => launchUrl(Uri.parse(r.url!),
                                      mode: LaunchMode.externalApplication),
                              child: Row(
                                children: [
                                  const Icon(Icons.description_outlined,
                                      size: 16, color: AppColors.primary),
                                  const SizedBox(width: 8),
                                  Expanded(
                                    child: Text(r.title,
                                        style: const TextStyle(
                                            color: AppColors.primary)),
                                  ),
                                ],
                              ),
                            ),
                            _reportSummary(r),
                          ],
                        ),
                      ))
                  .toList(),
            ),
          ],
        ],
      ),
    );
  }

  /// Combined summary across every report for this visit — the doctor reads
  /// this first. Hidden when there's nothing combined to show (0-1 reports).
  Widget _visitSummary(Appointment a) {
    final status = a.reportsSummaryStatus;
    if (a.reports.length < 2 && status != 'ready') return const SizedBox.shrink();

    Widget body;
    if (status == 'processing') {
      body = const Text('Combining the report summaries…',
          style: TextStyle(color: AppColors.textSecondary, fontSize: 12.5));
    } else if (status == 'failed') {
      body = Row(
        children: [
          Expanded(
            child: Text(
              'Couldn’t combine the summaries.'
              '${a.reportsSummaryError != null ? ' ${a.reportsSummaryError}' : ''}',
              style: const TextStyle(
                  color: AppColors.textSecondary, fontSize: 12.5),
            ),
          ),
          TextButton(
            onPressed: () async {
              try {
                await _api.retryVisitSummary(widget.id);
                if (mounted) {
                  showSuccessSnack(context, 'Combining again…');
                  setState(() => _future = _api.getAppointment(widget.id));
                }
              } on ApiException catch (e) {
                if (mounted) showErrorSnack(context, e.message);
              }
            },
            child: const Text('Retry'),
          ),
        ],
      );
    } else if (a.reportsSummary != null) {
      body = _summaryBody(a.reportsSummary!);
    } else {
      return const SizedBox.shrink();
    }

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.primaryTint,
        borderRadius: BorderRadius.circular(AppRadius.control),
        border: Border.all(color: AppColors.primary.withValues(alpha: 0.35)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            a.reportsSummaryCount > 0
                ? 'Combined summary · across ${a.reportsSummaryCount} reports'
                : 'Combined summary',
            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5),
          ),
          const SizedBox(height: 6),
          body,
        ],
      ),
    );
  }

  /// Shared renderer for a ReportAiSummary (combined or per-report).
  Widget _summaryBody(ReportAiSummary summary) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (summary.reportType.isNotEmpty)
          Text(summary.reportType,
              style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 12.5)),
        Text(summary.summary, style: const TextStyle(fontSize: 13)),
        if (summary.abnormalValues.isNotEmpty) ...[
          const SizedBox(height: 8),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: summary.abnormalValues
                .map((v) => Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: v.direction == 'high'
                            ? AppColors.errorTint
                            : AppColors.onHoldTint,
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Text('${v.label}: ${v.value}',
                          style: TextStyle(
                              fontSize: 11.5,
                              color: v.direction == 'high'
                                  ? AppColors.error
                                  : AppColors.onHold)),
                    ))
                .toList(),
          ),
        ],
        if (summary.keyFindings.isNotEmpty) ...[
          const SizedBox(height: 6),
          ...summary.keyFindings.map((f) =>
              Text('• $f', style: const TextStyle(fontSize: 12.5))),
        ],
        const SizedBox(height: 6),
        const Text('AI-generated — check the reports themselves before acting.',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 11)),
      ],
    );
  }

  // ── Prescriptions ──────────────────────────────────────────
  Future<void> _pickPrescriptions(Appointment a) async {
    final picked =
        await ImagePicker().pickMultiImage(imageQuality: 85);
    if (picked.isEmpty) return;
    final files = picked.map((x) => File(x.path)).toList();
    await _run(() => _api.addPrescriptions(a.id, files),
        'Prescription${files.length > 1 ? 's' : ''} uploaded');
  }

  Future<void> _confirmDeleteRx(Appointment a, String prescriptionId) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Delete prescription?'),
        content: const Text('This image will be removed permanently.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(c, false),
              child: const Text('Cancel')),
          TextButton(
              onPressed: () => Navigator.pop(c, true),
              child: const Text('Delete')),
        ],
      ),
    );
    if (ok == true) {
      await _run(() => _api.deletePrescription(a.id, prescriptionId),
          'Prescription deleted');
    }
  }

  Widget _prescriptionsCard(Appointment a, bool canUpdate) {
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const CardTitle('Prescriptions'),
          if (a.prescriptions.isEmpty)
            const Text('No prescriptions uploaded yet.',
                style: TextStyle(color: AppColors.textSecondary))
          else
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: a.prescriptions
                  .map((p) => _RxThumb(
                        url: p.url,
                        onDelete: canUpdate && !_busy
                            ? () => _confirmDeleteRx(a, p.id)
                            : null,
                      ))
                  .toList(),
            ),
          if (canUpdate) ...[
            const SizedBox(height: 12),
            Align(
              alignment: Alignment.centerLeft,
              child: OutlinedButton.icon(
                onPressed: _busy ? null : () => _pickPrescriptions(a),
                icon: const Icon(Icons.add_photo_alternate_outlined, size: 18),
                label: const Text('Upload images'),
              ),
            ),
          ],
        ],
      ),
    );
  }

  // ── Patient history ────────────────────────────────────────
  Widget _historyCard(Appointment a) {
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const CardTitle('Previous visits'),
          FutureBuilder<List<Appointment>>(
            future: _history,
            builder: (context, snap) {
              if (snap.connectionState == ConnectionState.waiting) {
                return const Padding(
                  padding: EdgeInsets.symmetric(vertical: 8),
                  child: Text('Loading history…',
                      style: TextStyle(color: AppColors.textSecondary)),
                );
              }
              final list = snap.data ?? [];
              if (list.isEmpty) {
                return const Text('No earlier visits for this patient.',
                    style: TextStyle(color: AppColors.textSecondary));
              }
              return Column(
                children: list.map(_historyTile).toList(),
              );
            },
          ),
        ],
      ),
    );
  }

  Widget _historyTile(Appointment h) {
    final rx = h.prescriptions;
    return Theme(
      data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
      child: ExpansionTile(
        tilePadding: EdgeInsets.zero,
        childrenPadding: const EdgeInsets.only(bottom: 8),
        title: Text('${h.appointmentDate} · ${h.startTime}',
            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500)),
        subtitle: Text(
          h.consultationStatus == 'done' ? 'Consultation done' : h.status,
          style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
        ),
        children: [
          if (h.description != null && h.description!.isNotEmpty)
            _histLine('Reason', h.description!),
          if (h.doctorNotes != null && h.doctorNotes!.isNotEmpty)
            _histLine('Note', h.doctorNotes!),
          if (rx.isNotEmpty) ...[
            const Align(
              alignment: Alignment.centerLeft,
              child: Padding(
                padding: EdgeInsets.only(top: 4, bottom: 6),
                child: Text('Prescriptions',
                    style: TextStyle(
                        color: AppColors.textSecondary, fontSize: 12)),
              ),
            ),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: rx.map((p) => _RxThumb(url: p.url)).toList(),
            ),
          ],
          if (h.reports.isNotEmpty) ...[
            const Align(
              alignment: Alignment.centerLeft,
              child: Padding(
                padding: EdgeInsets.only(top: 4, bottom: 6),
                child: Text('Reports',
                    style: TextStyle(
                        color: AppColors.textSecondary, fontSize: 12)),
              ),
            ),
            ...h.reports.map((r) => Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: InkWell(
                    onTap: r.url == null
                        ? null
                        : () => launchUrl(Uri.parse(r.url!),
                            mode: LaunchMode.externalApplication),
                    child: Text('📄 ${r.title}',
                        style: const TextStyle(
                            color: AppColors.primary, fontSize: 13)),
                  ),
                )),
          ],
          if ((h.description == null || h.description!.isEmpty) &&
              (h.doctorNotes == null || h.doctorNotes!.isEmpty) &&
              rx.isEmpty &&
              h.reports.isEmpty)
            const Align(
              alignment: Alignment.centerLeft,
              child: Text('No notes or prescriptions recorded.',
                  style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
            ),
        ],
      ),
    );
  }

  Widget _histLine(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: RichText(
        text: TextSpan(
          style: const TextStyle(color: AppColors.text, fontSize: 13),
          children: [
            TextSpan(
                text: '$label: ',
                style: const TextStyle(color: AppColors.textSecondary)),
            TextSpan(text: value),
          ],
        ),
      ),
    );
  }

  Widget _row(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label,
              style: const TextStyle(
                  color: AppColors.textSecondary, fontSize: 12)),
          const SizedBox(height: 2),
          Text(value, style: const TextStyle(fontSize: 15)),
        ],
      ),
    );
  }
}

/// A prescription image thumbnail. Tap to view full-size; optional delete badge.
class _RxThumb extends StatelessWidget {
  final String? url;
  final VoidCallback? onDelete;
  const _RxThumb({required this.url, this.onDelete});

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        InkWell(
          onTap: url == null || url!.isEmpty
              ? null
              : () => Navigator.push(
                    context,
                    MaterialPageRoute(
                        builder: (_) => _ImageViewer(url: url!)),
                  ),
          child: NetworkThumb(
            url: url,
            size: 84,
            radius: AppRadius.control,
            fallback: Icons.description_outlined,
          ),
        ),
        if (onDelete != null)
          Positioned(
            top: -6,
            right: -6,
            child: IconButton(
              icon: const CircleAvatar(
                radius: 12,
                backgroundColor: AppColors.error,
                child: Icon(Icons.close, size: 14, color: Colors.white),
              ),
              onPressed: onDelete,
            ),
          ),
      ],
    );
  }
}

/// Full-screen prescription image viewer.
class _ImageViewer extends StatelessWidget {
  final String url;
  const _ImageViewer({required this.url});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        iconTheme: const IconThemeData(color: Colors.white),
      ),
      body: Center(
        child: InteractiveViewer(
          child: Image.network(url,
              errorBuilder: (_, _, _) => const Text('Could not load image.',
                  style: TextStyle(color: Colors.white70))),
        ),
      ),
    );
  }
}

/// Pick a new date + slot for a reschedule. Pops `(date, startTime)` on confirm.
class _RescheduleScreen extends StatefulWidget {
  final ApiClient api;
  final String doctorId;
  const _RescheduleScreen({required this.api, required this.doctorId});

  @override
  State<_RescheduleScreen> createState() => _RescheduleScreenState();
}

class _RescheduleScreenState extends State<_RescheduleScreen> {
  String? _date;
  Slot? _slot;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Reschedule')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          SectionCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const CardTitle('Pick a new slot'),
                SlotSelector(
                  api: widget.api,
                  doctorId: widget.doctorId,
                  onChanged: (date, slot) =>
                      setState(() { _date = date; _slot = slot; }),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),
          SizedBox(
            height: 50,
            child: ElevatedButton(
              onPressed: (_date != null && _slot != null)
                  ? () => Navigator.pop(context, (_date!, _slot!.startTime))
                  : null,
              child: const Text('Confirm new slot'),
            ),
          ),
        ],
      ),
    );
  }
}
