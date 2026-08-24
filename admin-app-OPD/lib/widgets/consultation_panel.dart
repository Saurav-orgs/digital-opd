import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/api_client.dart';
import '../api/models.dart';
import '../auth/auth_scope.dart';
import '../theme.dart';
import 'common.dart';
import 'handwriting_pad.dart';

/// Records the OPD conversation, then shows the AI-drafted prescription for the
/// doctor to correct and issue. Also supports Handwriting, Structured Typing,
/// and Uploading prescription images.
class ConsultationPanel extends StatefulWidget {
  final String appointmentId;
  final bool canEdit;
  final VoidCallback? onChanged;
  const ConsultationPanel({
    super.key,
    required this.appointmentId,
    required this.canEdit,
    this.onChanged,
  });

  @override
  State<ConsultationPanel> createState() => _ConsultationPanelState();
}

class _ConsultationPanelState extends State<ConsultationPanel> {
  final _recorder = AudioRecorder();

  bool _recording = false;
  bool _uploading = false;
  bool _uploadingImages = false;
  int _elapsed = 0;
  Timer? _tick;
  Timer? _poll;

  ConsultationSession? _session;
  EPrescription? _prescription;
  Appointment? _appointment;
  bool _loading = true;
  bool _saving = false;

  // Which input method is showing: handwrite | voice | type | upload.
  String _mode = 'voice';
  final HandwritingController _handwriting = HandwritingController();

  // Local edit buffer — replaced from the server only when not mid-edit.
  final _diagnosis = TextEditingController();
  final _advice = TextEditingController();
  List<PrescriptionMedicine> _medicines = [PrescriptionMedicine()];
  bool _dirty = false;

  ApiClient get _api => AuthScope.of(context).api;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_loading) _load();
  }

  @override
  void dispose() {
    _tick?.cancel();
    _poll?.cancel();
    _recorder.dispose();
    _diagnosis.dispose();
    _advice.dispose();
    _handwriting.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final session = await _api.getConsultation(widget.appointmentId);
      final prescription = await _api.getPrescription(widget.appointmentId);
      final appointment = await _api.getAppointment(widget.appointmentId);
      if (!mounted) return;
      setState(() {
        _session = session;
        _appointment = appointment;
        _loading = false;
        if (!_dirty) _adopt(prescription);
      });
      if (session?.inProgress ?? false) _startPolling();
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// Take the server's version as the source of truth for the editor.
  void _adopt(EPrescription p) {
    _prescription = p;
    _diagnosis.text = p.diagnosis ?? '';
    _advice.text = p.advice ?? '';
    if (p.medicines.isNotEmpty) {
      _medicines = p.medicines
          .map((m) => PrescriptionMedicine(
                id: m.id,
                medicineName: m.medicineName,
                strength: m.strength,
                form: m.form,
                dosage: m.dosage,
                timing: m.timing,
                durationDays: m.durationDays,
                instructions: m.instructions,
                source: m.source,
              ))
          .toList();
    } else {
      _medicines = [PrescriptionMedicine()];
    }
  }

  void _startPolling() {
    _poll?.cancel();
    _poll = Timer.periodic(const Duration(seconds: 5), (t) async {
      if (!mounted) {
        t.cancel();
        return;
      }
      try {
        final session = await _api.getConsultation(widget.appointmentId);
        if (!mounted) return;
        setState(() => _session = session);
        if (!(session?.inProgress ?? false)) {
          t.cancel();
          // The draft lands with the finished session.
          final prescription = await _api.getPrescription(widget.appointmentId);
          if (mounted) {
            setState(() {
              _dirty = false;
              _adopt(prescription);
            });
          }
        }
      } catch (_) {
        // Transient failure while polling is not worth surfacing.
      }
    });
  }

  // ── recording ────────────────────────────────────────────

  Future<void> _startRecording() async {
    if (!await _recorder.hasPermission()) {
      if (mounted) {
        showErrorSnack(context, 'Microphone permission is needed to record.');
      }
      return;
    }
    final dir = await getTemporaryDirectory();
    final path =
        '${dir.path}/consultation_${DateTime.now().millisecondsSinceEpoch}.m4a';

    await _recorder.start(
      const RecordConfig(
        encoder: AudioEncoder.aacLc,
        bitRate: 128000,
        sampleRate: 44100,
        echoCancel: true,
        noiseSuppress: true,
        autoGain: true,
      ),
      path: path,
    );
    if (!mounted) return;
    setState(() {
      _recording = true;
      _elapsed = 0;
    });
    _tick = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() => _elapsed++);
    });
  }

  Future<void> _stopRecording() async {
    _tick?.cancel();
    final path = await _recorder.stop();
    if (!mounted) return;
    setState(() => _recording = false);
    if (path == null) return;

    setState(() => _uploading = true);
    try {
      final session =
          await _api.uploadConsultationAudio(widget.appointmentId, File(path));
      if (!mounted) return;
      setState(() => _session = session);
      _startPolling();
      showSuccessSnack(context, 'Recording sent — drafting the prescription…');
    } on ApiException catch (e) {
      if (mounted) showErrorSnack(context, e.message);
    } finally {
      // The audio is never kept locally either.
      try {
        await File(path).delete();
      } catch (_) {}
      if (mounted) setState(() => _uploading = false);
    }
  }

  // ── saving ───────────────────────────────────────────────

  Map<String, dynamic> _body() => {
        'diagnosis': _diagnosis.text.trim(),
        'advice': _advice.text.trim(),
        'medicines': _medicines
            .where((m) => m.medicineName.trim().isNotEmpty)
            .map((m) => m.toJson())
            .toList(),
      };

  Future<void> _save({bool thenIssue = false}) async {
    setState(() => _saving = true);
    try {
      var updated = await _api.savePrescription(widget.appointmentId, _body());
      if (thenIssue) {
        updated = await _api.issuePrescription(widget.appointmentId);
      }
      if (!mounted) return;
      setState(() {
        _dirty = false;
        _adopt(updated);
      });
      showSuccessSnack(
        context,
        thenIssue ? 'Prescription issued — the patient has been notified.' : 'Draft saved',
      );
    } on ApiException catch (e) {
      if (mounted) showErrorSnack(context, e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  String get _elapsedLabel {
    final m = _elapsed ~/ 60;
    final s = (_elapsed % 60).toString().padLeft(2, '0');
    return '$m:$s';
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const SectionCard(child: StateView(loading: true));
    }

    final issued = _prescription?.isIssued ?? false;

    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const CardTitle('Prescription'),
          const SizedBox(height: 10),
          if (!issued) ...[
            _modeTabs(),
            const SizedBox(height: 16),
          ],
          if (issued) _issuedView() else _modeBody(),
        ],
      ),
    );
  }

  Widget _modeTabs() {
    Widget tab(String id, String label) {
      final active = _mode == id;
      void onTap() => setState(() => _mode = id);
      return Padding(
        padding: const EdgeInsets.only(right: 8),
        child: active
            ? ElevatedButton(onPressed: onTap, child: Text(label))
            : OutlinedButton(onPressed: onTap, child: Text(label)),
      );
    }

    final rxCount = _appointment?.prescriptions.length ?? 0;
    final uploadLabel = rxCount > 0 ? '📷 Upload Rx ($rxCount)' : '📷 Upload Rx';

    return Wrap(
      runSpacing: 8,
      children: [
        tab('handwrite', '✍️ Handwrite'),
        tab('voice', '🎙 Voice'),
        tab('type', '⌨️ Type'),
        tab('upload', uploadLabel),
      ],
    );
  }

  Widget _modeBody() {
    switch (_mode) {
      case 'handwrite':
        return _handwriteBody();
      case 'type':
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Fill in the diagnosis, medicines and advice, then issue when ready.',
              style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
            ),
            const SizedBox(height: 12),
            _editor(),
          ],
        );
      case 'upload':
        return _uploadBody();
      case 'voice':
      default:
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Record the consultation and the system drafts a prescription. '
              'Nothing is sent to the patient until you issue it.',
              style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
            ),
            const SizedBox(height: 12),
            if (widget.canEdit) _recordControls(),
            if (_session != null) ...[
              const SizedBox(height: 10),
              _sessionStatus(),
            ],
            const Divider(height: 28),
            _editor(),
          ],
        );
    }
  }

  Widget _uploadBody() {
    final prescriptions = _appointment?.prescriptions ?? [];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Upload photos or scanned copies of the physical prescription.',
          style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
        ),
        const SizedBox(height: 12),
        if (prescriptions.isEmpty)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(vertical: 24, horizontal: 16),
            decoration: BoxDecoration(
              color: AppColors.page,
              borderRadius: BorderRadius.circular(AppRadius.control),
              border: Border.all(color: AppColors.border, width: 0.5),
            ),
            child: const Column(
              children: [
                Icon(Icons.description_outlined, size: 36, color: AppColors.textSecondary),
                SizedBox(height: 8),
                Text(
                  'No prescription images uploaded yet',
                  style: TextStyle(fontWeight: FontWeight.w500, fontSize: 13),
                ),
                SizedBox(height: 2),
                Text(
                  'Upload photos of physical prescription pad or records',
                  style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
                ),
              ],
            ),
          )
        else
          Wrap(
            spacing: 12,
            runSpacing: 12,
            children: prescriptions.map((p) {
              return Stack(
                clipBehavior: Clip.none,
                children: [
                  GestureDetector(
                    onTap: p.url == null
                        ? null
                        : () => launchUrl(Uri.parse(p.url!), mode: LaunchMode.externalApplication),
                    child: Container(
                      width: 90,
                      height: 90,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(AppRadius.control),
                        border: Border.all(color: AppColors.border, width: 0.5),
                      ),
                      clipBehavior: Clip.antiAlias,
                      child: p.url != null && p.url!.isNotEmpty
                          ? Image.network(
                              p.url!,
                              fit: BoxFit.cover,
                              errorBuilder: (_, _, _) => Container(
                                color: AppColors.page,
                                child: const Icon(Icons.broken_image, color: AppColors.textSecondary),
                              ),
                            )
                          : Container(
                              color: AppColors.page,
                              child: const Icon(Icons.description, color: AppColors.textSecondary),
                            ),
                    ),
                  ),
                  if (widget.canEdit)
                    Positioned(
                      top: -6,
                      right: -6,
                      child: GestureDetector(
                        onTap: _uploadingImages ? null : () => _deletePrescription(p.id),
                        child: Container(
                          width: 22,
                          height: 22,
                          decoration: const BoxDecoration(
                            color: AppColors.error,
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(Icons.close, size: 14, color: Colors.white),
                        ),
                      ),
                    ),
                ],
              );
            }).toList(),
          ),
        if (widget.canEdit) ...[
          const SizedBox(height: 14),
          OutlinedButton.icon(
            onPressed: _uploadingImages ? null : _pickAndUploadImages,
            icon: _uploadingImages
                ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.upload_file, size: 18),
            label: Text(_uploadingImages ? 'Uploading…' : '+ Upload prescription images'),
          ),
        ],
      ],
    );
  }

  Future<void> _pickAndUploadImages() async {
    final picker = ImagePicker();
    final picked = await picker.pickMultiImage();
    if (picked.isEmpty) return;

    setState(() => _uploadingImages = true);
    try {
      final files = picked.map((x) => File(x.path)).toList();
      final updated = await _api.addPrescriptions(widget.appointmentId, files);
      if (!mounted) return;
      setState(() => _appointment = updated);
      widget.onChanged?.call();
      showSuccessSnack(context, 'Prescription uploaded');
    } on ApiException catch (e) {
      if (mounted) showErrorSnack(context, e.message);
    } finally {
      if (mounted) setState(() => _uploadingImages = false);
    }
  }

  Future<void> _deletePrescription(String rxId) async {
    setState(() => _uploadingImages = true);
    try {
      final updated = await _api.deletePrescription(widget.appointmentId, rxId);
      if (!mounted) return;
      setState(() => _appointment = updated);
      widget.onChanged?.call();
      showSuccessSnack(context, 'Prescription deleted');
    } on ApiException catch (e) {
      if (mounted) showErrorSnack(context, e.message);
    } finally {
      if (mounted) setState(() => _uploadingImages = false);
    }
  }

  Widget _handwriteBody() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        HandwritingPad(
          controller: _handwriting,
          enabled: widget.canEdit,
          onOpenFullscreen: _openHandwritingFullscreen,
        ),
        if (widget.canEdit) ...[
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              ElevatedButton(
                onPressed: _saving ? null : _issueHandwriting,
                child: Text(_saving ? 'Issuing…' : 'Issue prescription'),
              ),
            ],
          ),
        ],
      ],
    );
  }

  void _openHandwritingFullscreen() {
    Navigator.push(
      context,
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => FullScreenHandwritingScreen(
          controller: _handwriting,
          enabled: widget.canEdit,
          onIssue: widget.canEdit ? _issueHandwriting : null,
        ),
      ),
    );
  }

  Future<void> _issueHandwriting() async {
    if (!_handwriting.hasContent) {
      showErrorSnack(context, 'Write the prescription before issuing.');
      return;
    }
    setState(() => _saving = true);
    try {
      final png = await _handwriting.export();
      if (png == null) {
        throw ApiException('EXPORT', 'Could not read the drawing.', 0);
      }
      await _api.saveHandwriting(widget.appointmentId, png);
      final issued = await _api.issuePrescription(widget.appointmentId);
      if (!mounted) return;
      setState(() => _adopt(issued));
      showSuccessSnack(
          context, 'Prescription issued — the patient has been notified.');
    } on ApiException catch (e) {
      if (mounted) showErrorSnack(context, e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Widget _recordControls() {
    if (_uploading) {
      return const Row(
        children: [
          SizedBox(
              width: 16,
              height: 16,
              child: CircularProgressIndicator(strokeWidth: 2.2)),
          SizedBox(width: 10),
          Text('Uploading the recording…',
              style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
        ],
      );
    }

    if (_recording) {
      return Row(
        children: [
          ElevatedButton.icon(
            onPressed: _stopRecording,
            icon: const Icon(Icons.stop, size: 18),
            label: const Text('Stop listening'),
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.error),
          ),
          const SizedBox(width: 12),
          Container(
            width: 8,
            height: 8,
            decoration: const BoxDecoration(
                color: AppColors.error, shape: BoxShape.circle),
          ),
          const SizedBox(width: 6),
          Text('Recording · $_elapsedLabel',
              style: const TextStyle(fontSize: 13)),
        ],
      );
    }

    return ElevatedButton.icon(
      onPressed: _startRecording,
      icon: const Icon(Icons.mic, size: 18),
      label: const Text('Start listening'),
    );
  }

  Widget _sessionStatus() {
    final s = _session!;
    if (s.status == 'failed') {
      return Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: AppColors.errorTint,
          borderRadius: BorderRadius.circular(AppRadius.control),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Couldn’t process the recording: ${s.error ?? 'unknown error'}',
                style: const TextStyle(color: AppColors.error, fontSize: 12.5)),
            const SizedBox(height: 4),
            const Text('You can still write the prescription by hand below.',
                style: TextStyle(fontSize: 12.5)),
          ],
        ),
      );
    }
    if (s.inProgress) {
      return Row(
        children: [
          const SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(strokeWidth: 2)),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              s.status == 'transcribing'
                  ? 'Transcribing — this can take a few minutes.'
                  : 'Writing the prescription draft…',
              style: const TextStyle(
                  color: AppColors.textSecondary, fontSize: 12.5),
            ),
          ),
        ],
      );
    }
    if (s.transcript != null && s.transcript!.isNotEmpty) {
      return ExpansionTile(
        tilePadding: EdgeInsets.zero,
        childrenPadding: const EdgeInsets.only(bottom: 8),
        title: const Text('What the system heard',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 12.5)),
        children: [
          Align(
            alignment: Alignment.centerLeft,
            child: Text(s.transcript!, style: const TextStyle(fontSize: 13)),
          ),
        ],
      );
    }
    return const SizedBox.shrink();
  }

  Widget _issuedView() {
    final p = _prescription!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const StatusBadge('done', label: 'Issued'),
            const Spacer(),
            if (p.pdfUrl != null && p.pdfUrl!.isNotEmpty)
              TextButton.icon(
                onPressed: () => launchUrl(Uri.parse(p.pdfUrl!),
                    mode: LaunchMode.externalApplication),
                icon: const Icon(Icons.download_outlined, size: 16),
                label: const Text('PDF'),
              ),
          ],
        ),
        if (p.isHandwritten && p.handwritingImageUrl != null) ...[
          const SizedBox(height: 10),
          ClipRRect(
            borderRadius: BorderRadius.circular(AppRadius.control),
            child: Container(
              color: Colors.white,
              child: Image.network(p.handwritingImageUrl!,
                  width: double.infinity,
                  fit: BoxFit.contain,
                  errorBuilder: (_, _, _) => const SizedBox.shrink()),
            ),
          ),
        ],
        if (p.diagnosis != null && p.diagnosis!.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text('Diagnosis: ${p.diagnosis}',
                style: const TextStyle(fontSize: 13.5)),
          ),
        const SizedBox(height: 8),
        ...p.medicines.asMap().entries.map((e) {
          final m = e.value;
          final title = [m.medicineName, m.strength]
              .where((x) => x != null && x.isNotEmpty)
              .join(' ');
          return Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('${e.key + 1}. $title',
                    style: const TextStyle(
                        fontWeight: FontWeight.w600, fontSize: 13.5)),
                Padding(
                  padding: const EdgeInsets.only(left: 14),
                  child: Text(
                    [
                      m.dosage,
                      if (m.timing != null && m.timing!.isNotEmpty) m.timing!,
                      if (m.durationDays != null) '${m.durationDays} days',
                    ].where((x) => x.isNotEmpty).join(' · '),
                    style: const TextStyle(
                        color: AppColors.textSecondary, fontSize: 12.5),
                  ),
                ),
              ],
            ),
          );
        }),
        if (p.advice != null && p.advice!.isNotEmpty)
          Text('Advice: ${p.advice}', style: const TextStyle(fontSize: 13)),
      ],
    );
  }

  Widget _editor() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        LabeledField(
          label: 'Diagnosis',
          child: TextField(
            controller: _diagnosis,
            enabled: widget.canEdit,
            onChanged: (_) => _dirty = true,
          ),
        ),
        const Text('Medicines',
            style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
        const SizedBox(height: 6),
        ..._medicines.asMap().entries.map((e) => _medicineCard(e.key, e.value)),
        if (widget.canEdit)
          OutlinedButton.icon(
            onPressed: () => setState(() {
              _dirty = true;
              _medicines.add(PrescriptionMedicine());
            }),
            icon: const Icon(Icons.add, size: 16),
            label: const Text('Add medicine'),
          ),
        const SizedBox(height: 8),
        LabeledField(
          label: 'Advice',
          child: TextField(
            controller: _advice,
            enabled: widget.canEdit,
            maxLines: 2,
            onChanged: (_) => _dirty = true,
          ),
        ),
        if (widget.canEdit)
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              OutlinedButton(
                onPressed: _saving ? null : () => _save(),
                child: const Text('Save draft'),
              ),
              const SizedBox(width: 10),
              ElevatedButton(
                onPressed: _saving ? null : () => _save(thenIssue: true),
                child: Text(_saving ? 'Working…' : 'Issue prescription'),
              ),
            ],
          ),
      ],
    );
  }

  Widget _medicineCard(int index, PrescriptionMedicine m) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: m.fromAi ? AppColors.primaryTint : Colors.white,
        borderRadius: BorderRadius.circular(AppRadius.control),
        border: Border.all(color: AppColors.border, width: 0.5),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  Text(
                    'Medicine #${index + 1}',
                    style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13, color: AppColors.primary),
                  ),
                  if (m.fromAi) ...[
                    const SizedBox(width: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: AppColors.primaryTint,
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: const Text('AI Suggested', style: TextStyle(fontSize: 11, color: AppColors.primary)),
                    ),
                  ],
                ],
              ),
              if (widget.canEdit)
                TextButton(
                  onPressed: () => setState(() {
                    _dirty = true;
                    _medicines.removeAt(index);
                    if (_medicines.isEmpty) {
                      _medicines.add(PrescriptionMedicine());
                    }
                  }),
                  style: TextButton.styleFrom(
                    foregroundColor: AppColors.error,
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    minimumSize: Size.zero,
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                  child: Text(_medicines.length > 1 ? '✕ Remove' : 'Clear'),
                ),
            ],
          ),
          const SizedBox(height: 6),
          TextFormField(
            initialValue: m.medicineName,
            enabled: widget.canEdit,
            decoration: const InputDecoration(
              labelText: 'Medicine name',
              hintText: 'e.g. Paracetamol',
              contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            ),
            onChanged: (v) {
              _dirty = true;
              m.medicineName = v;
            },
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: TextFormField(
                  initialValue: m.strength,
                  enabled: widget.canEdit,
                  decoration: const InputDecoration(
                    labelText: 'Strength',
                    hintText: 'e.g. 500mg',
                    contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                  ),
                  onChanged: (v) {
                    _dirty = true;
                    m.strength = v;
                  },
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: TextFormField(
                  initialValue: m.dosage,
                  enabled: widget.canEdit,
                  decoration: const InputDecoration(
                    labelText: 'Dosage',
                    hintText: '1-0-1',
                    contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                  ),
                  onChanged: (v) {
                    _dirty = true;
                    m.dosage = v;
                  },
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: TextFormField(
                  initialValue: m.timing,
                  enabled: widget.canEdit,
                  decoration: const InputDecoration(
                    labelText: 'Timing',
                    hintText: 'after food',
                    contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                  ),
                  onChanged: (v) {
                    _dirty = true;
                    m.timing = v;
                  },
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: TextFormField(
                  initialValue: m.durationDays?.toString(),
                  enabled: widget.canEdit,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: 'Duration (days)',
                    hintText: '5',
                    contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                  ),
                  onChanged: (v) {
                    _dirty = true;
                    m.durationDays = int.tryParse(v);
                  },
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          TextFormField(
            initialValue: m.instructions,
            enabled: widget.canEdit,
            decoration: const InputDecoration(
              labelText: 'Special instructions',
              hintText: 'e.g. with warm water',
              contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            ),
            onChanged: (v) {
              _dirty = true;
              m.instructions = v;
            },
          ),
        ],
      ),
    );
  }
}
