import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../api/api_client.dart';
import '../api/models.dart';
import '../auth/auth_scope.dart';
import '../config.dart';
import '../theme.dart';
import '../widgets/common.dart';

/// Super-admin screen for managing doctor tenants.
class DoctorsScreen extends StatefulWidget {
  const DoctorsScreen({super.key});

  @override
  State<DoctorsScreen> createState() => _DoctorsScreenState();
}

class _DoctorsScreenState extends State<DoctorsScreen> {
  Future<List<Doctor>>? _future;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _future ??= _load();
  }

  Future<List<Doctor>> _load() => AuthScope.of(context).api.listDoctors();

  void _reload() => setState(() => _future = _load());

  void _showCreate() async {
    final result = await showDialog<CreateDoctorResult>(
      context: context,
      builder: (_) => _CreateDoctorDialog(api: AuthScope.of(context).api),
    );
    if (result != null && mounted) {
      _reload();
      await showDialog(
        context: context,
        builder: (_) => _CredentialsDialog(result: result),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _showCreate,
        icon: const Icon(Icons.add),
        label: const Text('New doctor'),
      ),
      body: FutureBuilder<List<Doctor>>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const StateView(loading: true);
          }
          if (snap.hasError) {
            return StateView(
              error: 'Could not load doctors.',
              onRetry: _reload,
            );
          }
          final doctors = snap.data ?? [];
          if (doctors.isEmpty) {
            return const StateView(
              empty: 'No doctors yet. Tap + to create the first one.',
            );
          }
          return RefreshIndicator(
            onRefresh: () async => _reload(),
            child: ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: doctors.length,
              separatorBuilder: (_, _) => const SizedBox(height: 10),
              itemBuilder: (_, i) => _DoctorTile(
                doctor: doctors[i],
                api: AuthScope.of(context).api,
                onChanged: _reload,
              ),
            ),
          );
        },
      ),
    );
  }
}

class _DoctorTile extends StatefulWidget {
  final Doctor doctor;
  final ApiClient api;
  final VoidCallback onChanged;
  const _DoctorTile({
    required this.doctor,
    required this.api,
    required this.onChanged,
  });

  @override
  State<_DoctorTile> createState() => _DoctorTileState();
}

class _DoctorTileState extends State<_DoctorTile> {
  bool _busy = false;

  String get _qrUrl =>
      '${AppConfig.patientWebBase}/d/${widget.doctor.publicSlug}';

  Future<void> _toggle() async {
    setState(() => _busy = true);
    try {
      if (widget.doctor.isEnabled) {
        await widget.api.disableDoctor(widget.doctor.id);
      } else {
        await widget.api.enableDoctor(widget.doctor.id);
      }
      widget.onChanged();
    } on ApiException catch (e) {
      if (mounted) showErrorSnack(context, e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _edit() async {
    final updated = await showDialog<Doctor>(
      context: context,
      builder: (_) => _EditDoctorDialog(api: widget.api, doctor: widget.doctor),
    );
    if (updated != null && mounted) widget.onChanged();
  }

  Future<void> _delete() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Remove doctor?'),
        content: Text(
            'This will permanently remove ${widget.doctor.name} and cannot be undone.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(c, false),
              child: const Text('Cancel')),
          TextButton(
              onPressed: () => Navigator.pop(c, true),
              style: TextButton.styleFrom(
                  foregroundColor: const Color(0xFFDC2626)),
              child: const Text('Delete')),
        ],
      ),
    );
    if (ok != true) return;
    setState(() => _busy = true);
    try {
      await widget.api.deleteDoctor(widget.doctor.id);
      widget.onChanged();
    } on ApiException catch (e) {
      if (mounted) showErrorSnack(context, e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _rotateQr() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Rotate QR?'),
        content: const Text(
            'Old QR links will stop working. The doctor will need to share the new link.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(c, false),
              child: const Text('Cancel')),
          TextButton(
              onPressed: () => Navigator.pop(c, true),
              child: const Text('Rotate')),
        ],
      ),
    );
    if (ok != true) return;
    setState(() => _busy = true);
    try {
      await widget.api.regenerateSlug(widget.doctor.id);
      widget.onChanged();
    } on ApiException catch (e) {
      if (mounted) showErrorSnack(context, e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = widget.doctor;
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(d.name,
                        style: const TextStyle(
                            fontWeight: FontWeight.w600, fontSize: 16)),
                    if (d.specialization != null)
                      Text(d.specialization!,
                          style: const TextStyle(
                              color: AppColors.textSecondary, fontSize: 13)),
                  ],
                ),
              ),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: d.isEnabled
                      ? AppColors.primaryTint
                      : const Color(0xFFFEE2E2),
                  borderRadius: BorderRadius.circular(99),
                ),
                child: Text(
                  d.isEnabled ? 'Active' : 'Disabled',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: d.isEnabled
                        ? AppColors.primary
                        : const Color(0xFFB91C1C),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            decoration: BoxDecoration(
              color: AppColors.page,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(
              _qrUrl,
              style: const TextStyle(
                  fontSize: 12,
                  fontFamily: 'monospace',
                  color: AppColors.textSecondary),
            ),
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              OutlinedButton(
                onPressed: _busy ? null : _toggle,
                child: Text(d.isEnabled ? 'Disable' : 'Enable'),
              ),
              OutlinedButton(
                onPressed: _busy ? null : _edit,
                child: const Text('Edit'),
              ),
              OutlinedButton(
                onPressed: _busy ? null : _rotateQr,
                child: const Text('Rotate QR'),
              ),
              OutlinedButton.icon(
                onPressed: () {
                  Clipboard.setData(ClipboardData(text: _qrUrl));
                  showSuccessSnack(context, 'Link copied');
                },
                icon: const Icon(Icons.copy, size: 16),
                label: const Text('Copy link'),
              ),
              OutlinedButton(
                onPressed: _busy ? null : _delete,
                style: OutlinedButton.styleFrom(
                    foregroundColor: const Color(0xFFDC2626),
                    side: const BorderSide(color: Color(0xFFDC2626))),
                child: const Text('Delete'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _EditDoctorDialog extends StatefulWidget {
  final ApiClient api;
  final Doctor doctor;
  const _EditDoctorDialog({required this.api, required this.doctor});

  @override
  State<_EditDoctorDialog> createState() => _EditDoctorDialogState();
}

class _EditDoctorDialogState extends State<_EditDoctorDialog> {
  late final TextEditingController _name;
  late final TextEditingController _spec;
  late final TextEditingController _quals;
  late final TextEditingController _fee;
  late final TextEditingController _bio;
  bool _submitting = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final d = widget.doctor;
    _name = TextEditingController(text: d.name);
    _spec = TextEditingController(text: d.specialization ?? '');
    _quals = TextEditingController(text: d.qualifications ?? '');
    _fee = TextEditingController(
        text: d.consultationFee != null ? d.consultationFee! : '');
    _bio = TextEditingController(text: d.bio ?? '');
  }

  @override
  void dispose() {
    _name.dispose();
    _spec.dispose();
    _quals.dispose();
    _fee.dispose();
    _bio.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final name = _name.text.trim();
    if (name.length < 2) {
      setState(() => _error = 'Name must be at least 2 characters.');
      return;
    }
    setState(() { _submitting = true; _error = null; });
    try {
      final body = <String, dynamic>{'name': name};
      if (_spec.text.trim().isNotEmpty) body['specialization'] = _spec.text.trim();
      if (_quals.text.trim().isNotEmpty) body['qualifications'] = _quals.text.trim();
      if (_bio.text.trim().isNotEmpty) body['bio'] = _bio.text.trim();
      final feeStr = _fee.text.trim();
      if (feeStr.isNotEmpty) {
        final feeVal = num.tryParse(feeStr);
        if (feeVal == null || feeVal < 0) {
          setState(() { _error = 'Enter a valid fee amount.'; _submitting = false; });
          return;
        }
        body['consultation_fee'] = feeVal;
      }
      final updated = await widget.api.updateDoctor(widget.doctor.id, body);
      if (mounted) Navigator.pop(context, updated);
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.message; _submitting = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Edit doctor'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _field('Full name *', _name),
            _field('Specialization', _spec),
            _field('Qualifications', _quals),
            _field('Consultation fee (₹)', _fee,
                type: const TextInputType.numberWithOptions(decimal: true)),
            _field('Bio', _bio, maxLines: 3),
            if (_error != null) ...[
              const SizedBox(height: 8),
              Text(_error!,
                  style: const TextStyle(color: Colors.red, fontSize: 13)),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel')),
        ElevatedButton(
          onPressed: _submitting ? null : _submit,
          child: Text(_submitting ? 'Saving…' : 'Save'),
        ),
      ],
    );
  }

  Widget _field(String label, TextEditingController ctrl,
      {TextInputType? type, int maxLines = 1}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label,
              style: const TextStyle(
                  fontSize: 12,
                  color: AppColors.textSecondary,
                  fontWeight: FontWeight.w500)),
          const SizedBox(height: 4),
          TextField(
            controller: ctrl,
            keyboardType: type,
            maxLines: maxLines,
            decoration: const InputDecoration(isDense: true),
          ),
        ],
      ),
    );
  }
}

class _CreateDoctorDialog extends StatefulWidget {
  final ApiClient api;
  const _CreateDoctorDialog({required this.api});

  @override
  State<_CreateDoctorDialog> createState() => _CreateDoctorDialogState();
}

class _CreateDoctorDialogState extends State<_CreateDoctorDialog> {
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _spec = TextEditingController();
  final _quals = TextEditingController();
  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    _spec.dispose();
    _quals.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final name = _name.text.trim();
    final email = _email.text.trim();
    final password = _password.text;
    if (name.isEmpty || email.isEmpty || password.length < 8) {
      setState(() => _error =
          'Name, email, and a password (min 8 chars) are required.');
      return;
    }
    setState(() { _submitting = true; _error = null; });
    try {
      final result = await widget.api.createDoctor({
        'name': name,
        'email': email,
        'password': password,
        if (_spec.text.trim().isNotEmpty) 'specialization': _spec.text.trim(),
        if (_quals.text.trim().isNotEmpty) 'qualifications': _quals.text.trim(),
      });
      if (mounted) Navigator.pop(context, result);
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.message; _submitting = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Create doctor'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _field('Full name *', _name),
            _field('Login email *', _email,
                type: TextInputType.emailAddress),
            _field('Temporary password *', _password,
                obscure: true),
            _field('Specialization', _spec),
            _field('Qualifications', _quals),
            if (_error != null) ...[
              const SizedBox(height: 8),
              Text(_error!,
                  style: const TextStyle(color: Colors.red, fontSize: 13)),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel')),
        ElevatedButton(
          onPressed: _submitting ? null : _submit,
          child: Text(_submitting ? 'Creating…' : 'Create'),
        ),
      ],
    );
  }

  Widget _field(String label, TextEditingController ctrl,
      {TextInputType? type, bool obscure = false}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label,
              style: const TextStyle(
                  fontSize: 12,
                  color: AppColors.textSecondary,
                  fontWeight: FontWeight.w500)),
          const SizedBox(height: 4),
          TextField(
            controller: ctrl,
            keyboardType: type,
            obscureText: obscure,
            decoration: const InputDecoration(isDense: true),
          ),
        ],
      ),
    );
  }
}

class _CredentialsDialog extends StatelessWidget {
  final CreateDoctorResult result;
  const _CredentialsDialog({required this.result});

  @override
  Widget build(BuildContext context) {
    void copyRow(String v) {
      Clipboard.setData(ClipboardData(text: v));
      showSuccessSnack(context, 'Copied');
    }

    return AlertDialog(
      title: const Text('Doctor created'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Share these credentials with the doctor — shown only once.',
              style: TextStyle(color: AppColors.textSecondary, fontSize: 13),
            ),
            const SizedBox(height: 16),
            _row('Name', result.doctor.name, null),
            _row('Login email', result.loginEmail, () => copyRow(result.loginEmail)),
            _row('Temp password', result.tempPassword,
                () => copyRow(result.tempPassword)),
            _row('Booking link', result.qrUrl, () => copyRow(result.qrUrl)),
          ],
        ),
      ),
      actions: [
        ElevatedButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Done')),
      ],
    );
  }

  Widget _row(String label, String value, VoidCallback? onCopy) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label.toUpperCase(),
              style: const TextStyle(
                  fontSize: 10,
                  color: AppColors.textSecondary,
                  letterSpacing: 0.6,
                  fontWeight: FontWeight.w600)),
          const SizedBox(height: 4),
          Row(
            children: [
              Expanded(
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                  decoration: BoxDecoration(
                    color: AppColors.page,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(value,
                      style: const TextStyle(
                          fontSize: 13, fontFamily: 'monospace')),
                ),
              ),
              if (onCopy != null) ...[
                const SizedBox(width: 8),
                IconButton(
                    icon: const Icon(Icons.copy, size: 18),
                    tooltip: 'Copy',
                    onPressed: onCopy),
              ],
            ],
          ),
        ],
      ),
    );
  }
}
