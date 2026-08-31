import 'package:flutter/material.dart';
import '../api/api_client.dart';
import '../api/models.dart';
import '../auth/auth_scope.dart';
import '../theme.dart';
import '../widgets/common.dart';

/// Pathlab login accounts — reports:create + reports:read only (see
/// ReportsScreen). The web equivalent of `admin-OPD/src/pages/Pathlabs.tsx`.
class PathlabsScreen extends StatefulWidget {
  const PathlabsScreen({super.key});

  @override
  State<PathlabsScreen> createState() => _PathlabsScreenState();
}

class _PathlabsScreenState extends State<PathlabsScreen> {
  Future<List<User>>? _future;

  AuthController get _auth => AuthScope.of(context);

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _future ??= _auth.api.listPathlabs();
  }

  void _reload() => setState(() { _future = _auth.api.listPathlabs(); });

  Future<void> _refresh() async {
    _reload();
    await _future;
  }

  Future<void> _openForm(User? lab) async {
    final saved = await Navigator.push<bool>(
      context,
      MaterialPageRoute(builder: (_) => PathlabFormScreen(lab: lab)),
    );
    if (saved == true) _reload();
  }

  Future<void> _delete(User lab) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Delete pathlab?'),
        content: Text('Remove ${lab.name}? This cannot be undone.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(c, true), child: const Text('Delete')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await _auth.api.removePathlab(lab.id);
      _reload();
      if (mounted) showSuccessSnack(context, 'Pathlab removed');
    } on ApiException catch (e) {
      if (mounted) showErrorSnack(context, e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final canCreate = _auth.can('pathlabs', 'create');
    final canUpdate = _auth.can('pathlabs', 'update');
    final canDelete = _auth.can('pathlabs', 'delete');

    return Scaffold(
      floatingActionButton: canCreate
          ? FloatingActionButton.extended(
              onPressed: () => _openForm(null),
              icon: const Icon(Icons.add),
              label: const Text('Add pathlab'),
            )
          : null,
      body: FutureBuilder<List<User>>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const StateView(loading: true);
          }
          if (snap.hasError) {
            return StateView(error: 'Could not load pathlabs.', onRetry: _refresh);
          }
          final list = snap.data ?? [];
          if (list.isEmpty) {
            return RefreshIndicator(
              onRefresh: _refresh,
              child: ListView(children: const [
                SizedBox(height: 120),
                StateView(empty: 'No pathlabs yet.'),
              ]),
            );
          }
          return RefreshIndicator(
            onRefresh: _refresh,
            child: ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: list.length,
              separatorBuilder: (_, _) => const SizedBox(height: 10),
              itemBuilder: (context, i) {
                final lab = list[i];
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
                                Text(lab.name,
                                    style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
                                Text(lab.email,
                                    style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
                              ],
                            ),
                          ),
                          StatusBadge(lab.isActive ? 'active' : 'inactive',
                              label: lab.isActive ? 'Active' : 'Inactive'),
                        ],
                      ),
                      if (canUpdate || canDelete) ...[
                        const SizedBox(height: 10),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.end,
                          children: [
                            if (canUpdate)
                              OutlinedButton.icon(
                                onPressed: () => _openForm(lab),
                                icon: const Icon(Icons.edit_outlined, size: 16),
                                label: const Text('Edit'),
                              ),
                            if (canDelete) ...[
                              const SizedBox(width: 8),
                              OutlinedButton(
                                onPressed: () => _delete(lab),
                                style: OutlinedButton.styleFrom(
                                    foregroundColor: AppColors.error,
                                    side: const BorderSide(color: AppColors.error, width: 0.8)),
                                child: const Text('Delete'),
                              ),
                            ],
                          ],
                        ),
                      ],
                    ],
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

class PathlabFormScreen extends StatefulWidget {
  final User? lab;
  const PathlabFormScreen({super.key, this.lab});

  @override
  State<PathlabFormScreen> createState() => _PathlabFormScreenState();
}

class _PathlabFormScreenState extends State<PathlabFormScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _name;
  late final TextEditingController _email;
  final _password = TextEditingController();
  bool _active = true;
  bool _saving = false;

  ApiClient get _api => AuthScope.of(context).api;
  User? get _lab => widget.lab;

  @override
  void initState() {
    super.initState();
    _name = TextEditingController(text: _lab?.name ?? '');
    _email = TextEditingController(text: _lab?.email ?? '');
    _active = _lab?.isActive ?? true;
  }

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);
    try {
      final body = <String, dynamic>{
        'name': _name.text.trim(),
        'email': _email.text.trim(),
        'is_active': _active,
      };
      if (_password.text.isNotEmpty) body['password'] = _password.text;

      if (_lab == null) {
        await _api.createPathlab(body);
      } else {
        await _api.updatePathlab(_lab!.id, body);
      }
      if (mounted) {
        showSuccessSnack(context, _lab == null ? 'Pathlab created' : 'Pathlab updated');
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
      appBar: AppBar(title: Text(_lab == null ? 'Add pathlab' : 'Edit pathlab')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            LabeledField(
              label: 'Lab name',
              child: TextFormField(
                controller: _name,
                validator: (v) => (v ?? '').trim().isEmpty ? 'Name is required.' : null,
              ),
            ),
            LabeledField(
              label: 'Email',
              child: TextFormField(
                controller: _email,
                keyboardType: TextInputType.emailAddress,
                validator: (v) => (v ?? '').trim().isEmpty ? 'Email is required.' : null,
              ),
            ),
            LabeledField(
              label: _lab == null ? 'Password' : 'New password (leave blank to keep)',
              hint: 'Must be at least 8 characters.',
              child: PasswordField(
                controller: _password,
                validator: (v) {
                  final val = v ?? '';
                  if (_lab == null && val.length < 8) {
                    return 'Password must be at least 8 characters.';
                  }
                  if (val.isNotEmpty && val.length < 8) {
                    return 'Password must be at least 8 characters.';
                  }
                  return null;
                },
              ),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Active (can sign in)'),
              value: _active,
              activeThumbColor: AppColors.primary,
              onChanged: (v) => setState(() => _active = v),
            ),
            const SizedBox(height: 12),
            SizedBox(
              height: 50,
              child: ElevatedButton(
                onPressed: _saving ? null : _save,
                child: _saving
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2.2, color: Colors.white))
                    : const Text('Save'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
