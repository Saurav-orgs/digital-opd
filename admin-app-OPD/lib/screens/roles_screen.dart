import 'package:flutter/material.dart';
import '../api/api_client.dart';
import '../api/models.dart';
import '../auth/auth_scope.dart';
import '../theme.dart';
import '../widgets/common.dart';

const _actions = ['create', 'read', 'update', 'delete'];

class RolesScreen extends StatefulWidget {
  const RolesScreen({super.key});

  @override
  State<RolesScreen> createState() => _RolesScreenState();
}

class _RolesScreenState extends State<RolesScreen> {
  Future<List<Role>>? _future;

  AuthController get _auth => AuthScope.of(context);

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _future ??= _auth.api.listRoles();
  }

  void _reload() => setState(() { _future = _auth.api.listRoles(); });

  Future<void> _refresh() async {
    _reload();
    await _future;
  }

  Future<void> _openForm(Role? role) async {
    final saved = await Navigator.push<bool>(
      context,
      MaterialPageRoute(builder: (_) => RoleFormScreen(role: role)),
    );
    if (saved == true) _reload();
  }

  Future<void> _delete(Role r) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Delete role?'),
        content: Text('Remove "${r.name}"? This cannot be undone.'),
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
    if (ok != true) return;
    try {
      await _auth.api.removeRole(r.id);
      _reload();
      if (mounted) showSuccessSnack(context, 'Role deleted');
    } on ApiException catch (e) {
      if (mounted) showErrorSnack(context, e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final canCreate = _auth.can('roles', 'create');
    final canUpdate = _auth.can('roles', 'update');
    final canDelete = _auth.can('roles', 'delete');

    return Scaffold(
      floatingActionButton: canCreate
          ? FloatingActionButton.extended(
              onPressed: () => _openForm(null),
              icon: const Icon(Icons.add),
              label: const Text('Add role'),
            )
          : null,
      body: FutureBuilder<List<Role>>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const StateView(loading: true);
          }
          if (snap.hasError) {
            return StateView(error: 'Could not load roles.', onRetry: _refresh);
          }
          final list = snap.data ?? [];
          if (list.isEmpty) {
            return RefreshIndicator(
              onRefresh: _refresh,
              child: ListView(children: const [
                SizedBox(height: 120),
                StateView(empty: 'No roles yet.'),
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
                final r = list[i];
                return SectionCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(r.name,
                                style: const TextStyle(
                                    fontWeight: FontWeight.w600, fontSize: 15)),
                          ),
                          if (r.isSystem)
                            const StatusBadge('info', label: 'system'),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Text(r.description ?? '—',
                          style: const TextStyle(
                              color: AppColors.textSecondary, fontSize: 13)),
                      const SizedBox(height: 4),
                      Text('${r.permissions.length} granted',
                          style: const TextStyle(
                              color: AppColors.textSecondary, fontSize: 12)),
                      if (!r.isSystem && (canUpdate || canDelete)) ...[
                        const SizedBox(height: 10),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.end,
                          children: [
                            if (canUpdate)
                              OutlinedButton.icon(
                                onPressed: () => _openForm(r),
                                icon: const Icon(Icons.edit_outlined, size: 16),
                                label: const Text('Edit'),
                              ),
                            if (canDelete) ...[
                              const SizedBox(width: 8),
                              OutlinedButton(
                                onPressed: () => _delete(r),
                                style: OutlinedButton.styleFrom(
                                    foregroundColor: AppColors.error,
                                    side: const BorderSide(
                                        color: AppColors.error, width: 0.8)),
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

class RoleFormScreen extends StatefulWidget {
  final Role? role;
  const RoleFormScreen({super.key, this.role});

  @override
  State<RoleFormScreen> createState() => _RoleFormScreenState();
}

class _RoleFormScreenState extends State<RoleFormScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _name;
  late final TextEditingController _description;
  final Set<String> _selected = {};

  Future<List<Permission>>? _permsFuture;
  bool _saving = false;

  ApiClient get _api => AuthScope.of(context).api;
  Role? get _role => widget.role;

  @override
  void initState() {
    super.initState();
    _name = TextEditingController(text: _role?.name ?? '');
    _description = TextEditingController(text: _role?.description ?? '');
    _selected.addAll(_role?.permissions.map((p) => p.id) ?? []);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _permsFuture ??= _api.listPermissions();
  }

  @override
  void dispose() {
    _name.dispose();
    _description.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);
    try {
      final body = {
        'name': _name.text.trim(),
        'description': _description.text.trim(),
        'permissionIds': _selected.toList(),
      };
      if (_role == null) {
        await _api.createRole(body);
      } else {
        await _api.updateRole(_role!.id, body);
      }
      if (mounted) {
        showSuccessSnack(
            context, _role == null ? 'Role created' : 'Role updated');
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
      appBar: AppBar(title: Text(_role == null ? 'Add role' : 'Edit role')),
      body: FutureBuilder<List<Permission>>(
        future: _permsFuture,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const StateView(loading: true);
          }
          if (snap.hasError) {
            return const StateView(error: 'Could not load permissions.');
          }
          // Group permissions by module → action → Permission.
          final byModule = <String, Map<String, Permission>>{};
          for (final p in snap.data ?? <Permission>[]) {
            (byModule[p.module] ??= {})[p.action] = p;
          }
          final modules = byModule.keys.toList();

          return Form(
            key: _formKey,
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                LabeledField(
                  label: 'Name',
                  child: TextFormField(
                    controller: _name,
                    validator: (v) =>
                        (v ?? '').trim().isEmpty ? 'Name is required.' : null,
                  ),
                ),
                LabeledField(
                  label: 'Description',
                  child: TextFormField(controller: _description),
                ),
                const SizedBox(height: 4),
                const Text(
                  'Modules a role can read appear in that user’s navigation.',
                  style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
                ),
                const SizedBox(height: 12),
                SectionCard(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    children: [
                      _headerRow(),
                      const Divider(height: 16),
                      ...modules.map((m) => _moduleRow(m, byModule[m]!)),
                    ],
                  ),
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
          );
        },
      ),
    );
  }

  Widget _headerRow() {
    return Row(
      children: [
        const Expanded(flex: 3, child: SizedBox()),
        ..._actions.map((a) => Expanded(
              flex: 2,
              child: Text(a,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                      color: AppColors.textSecondary, fontSize: 11)),
            )),
      ],
    );
  }

  Widget _moduleRow(String module, Map<String, Permission> actions) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          Expanded(
            flex: 3,
            child: Text(prettyStatus(module),
                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500)),
          ),
          ..._actions.map((a) {
            final perm = actions[a];
            return Expanded(
              flex: 2,
              child: perm == null
                  ? const Center(
                      child: Text('—',
                          style: TextStyle(color: AppColors.textSecondary)))
                  : Checkbox(
                      value: _selected.contains(perm.id),
                      activeColor: AppColors.primary,
                      visualDensity: VisualDensity.compact,
                      materialTapTargetSize:
                          MaterialTapTargetSize.shrinkWrap,
                      onChanged: (v) => setState(() {
                        if (v == true) {
                          _selected.add(perm.id);
                        } else {
                          _selected.remove(perm.id);
                        }
                      }),
                    ),
            );
          }),
        ],
      ),
    );
  }
}
