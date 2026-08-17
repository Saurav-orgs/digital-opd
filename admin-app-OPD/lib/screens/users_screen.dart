import 'package:flutter/material.dart';
import '../api/api_client.dart';
import '../api/models.dart';
import '../auth/auth_scope.dart';
import '../theme.dart';
import '../widgets/common.dart';

class UsersScreen extends StatefulWidget {
  const UsersScreen({super.key});

  @override
  State<UsersScreen> createState() => _UsersScreenState();
}

class _UsersScreenState extends State<UsersScreen> {
  Future<List<User>>? _future;

  AuthController get _auth => AuthScope.of(context);

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _future ??= _auth.api.listUsers();
  }

  void _reload() => setState(() { _future = _auth.api.listUsers(); });

  Future<void> _refresh() async {
    _reload();
    await _future;
  }

  Future<void> _openForm(User? user) async {
    final saved = await Navigator.push<bool>(
      context,
      MaterialPageRoute(builder: (_) => UserFormScreen(user: user)),
    );
    if (saved == true) _reload();
  }

  Future<void> _delete(User u) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Delete user?'),
        content: Text('Remove ${u.name}? This cannot be undone.'),
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
      await _auth.api.removeUser(u.id);
      _reload();
      if (mounted) showSuccessSnack(context, 'User removed');
    } on ApiException catch (e) {
      if (mounted) showErrorSnack(context, e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final canCreate = _auth.can('users', 'create');
    final canUpdate = _auth.can('users', 'update');
    final canDelete = _auth.can('users', 'delete');

    return Scaffold(
      floatingActionButton: canCreate
          ? FloatingActionButton.extended(
              onPressed: () => _openForm(null),
              icon: const Icon(Icons.add),
              label: const Text('Add user'),
            )
          : null,
      body: FutureBuilder<List<User>>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const StateView(loading: true);
          }
          if (snap.hasError) {
            return StateView(error: 'Could not load users.', onRetry: _refresh);
          }
          final list = snap.data ?? [];
          if (list.isEmpty) {
            return RefreshIndicator(
              onRefresh: _refresh,
              child: ListView(children: const [
                SizedBox(height: 120),
                StateView(empty: 'No users yet.'),
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
                final u = list[i];
                final isSuper = u.type == 'super_admin';
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
                                Text(u.name,
                                    style: const TextStyle(
                                        fontWeight: FontWeight.w600,
                                        fontSize: 15)),
                                Text(u.email,
                                    style: const TextStyle(
                                        color: AppColors.textSecondary,
                                        fontSize: 13)),
                              ],
                            ),
                          ),
                          StatusBadge(u.isActive ? 'active' : 'inactive',
                              label: u.isActive ? 'Active' : 'Inactive'),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 8,
                        runSpacing: 4,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          Text(prettyStatus(u.type),
                              style: const TextStyle(
                                  color: AppColors.textSecondary, fontSize: 12)),
                          if (u.role != null)
                            Text('· ${u.role!.name}',
                                style: const TextStyle(
                                    color: AppColors.textSecondary,
                                    fontSize: 12)),
                        ],
                      ),
                      if (!isSuper && (canUpdate || canDelete)) ...[
                        const SizedBox(height: 10),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.end,
                          children: [
                            if (canUpdate)
                              OutlinedButton.icon(
                                onPressed: () => _openForm(u),
                                icon: const Icon(Icons.edit_outlined, size: 16),
                                label: const Text('Edit'),
                              ),
                            if (canDelete) ...[
                              const SizedBox(width: 8),
                              OutlinedButton(
                                onPressed: () => _delete(u),
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

class UserFormScreen extends StatefulWidget {
  final User? user;
  const UserFormScreen({super.key, this.user});

  @override
  State<UserFormScreen> createState() => _UserFormScreenState();
}

class _UserFormScreenState extends State<UserFormScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _name;
  late final TextEditingController _email;
  final _password = TextEditingController();

  String _type = 'admin';
  String? _roleId;
  String? _doctorId;
  bool _active = true;
  bool _saving = false;

  List<Role> _roles = [];
  List<Doctor> _doctors = [];
  bool _loadingRefs = true;

  ApiClient get _api => AuthScope.of(context).api;
  User? get _user => widget.user;

  @override
  void initState() {
    super.initState();
    _name = TextEditingController(text: _user?.name ?? '');
    _email = TextEditingController(text: _user?.email ?? '');
    _type = _user?.type == 'doctor' ? 'doctor' : 'admin';
    _roleId = _user?.roleId;
    _doctorId = _user?.doctorId;
    _active = _user?.isActive ?? true;
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_loadingRefs) _loadRefs();
  }

  Future<void> _loadRefs() async {
    try {
      final roles = await _api.listRoles();
      final doctors = await _api.listDoctors();
      if (mounted) {
        setState(() {
          _roles = roles;
          _doctors = doctors;
          _loadingRefs = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loadingRefs = false);
    }
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
    if (_roleId == null) {
      showErrorSnack(context, 'Please select a role.');
      return;
    }
    if (_type == 'doctor' && _doctorId == null) {
      showErrorSnack(context, 'Please link a doctor profile.');
      return;
    }
    setState(() => _saving = true);
    try {
      final body = <String, dynamic>{
        'name': _name.text.trim(),
        'email': _email.text.trim(),
        'type': _type,
        'role_id': _roleId,
        'is_active': _active,
      };
      if (_type == 'doctor') body['doctor_id'] = _doctorId;
      if (_password.text.isNotEmpty) body['password'] = _password.text;

      if (_user == null) {
        await _api.createUser(body);
      } else {
        await _api.updateUser(_user!.id, body);
      }
      if (mounted) {
        showSuccessSnack(
            context, _user == null ? 'User created' : 'User updated');
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
      appBar: AppBar(title: Text(_user == null ? 'Add user' : 'Edit user')),
      body: _loadingRefs
          ? const StateView(loading: true)
          : Form(
              key: _formKey,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  LabeledField(
                    label: 'Name',
                    child: TextFormField(
                      controller: _name,
                      validator: (v) => (v ?? '').trim().isEmpty
                          ? 'Name is required.'
                          : null,
                    ),
                  ),
                  LabeledField(
                    label: 'Email',
                    child: TextFormField(
                      controller: _email,
                      keyboardType: TextInputType.emailAddress,
                      validator: (v) => (v ?? '').trim().isEmpty
                          ? 'Email is required.'
                          : null,
                    ),
                  ),
                  LabeledField(
                    label: _user == null
                        ? 'Password'
                        : 'New password (leave blank to keep)',
                    hint: 'Must be at least 8 characters.',
                    child: TextFormField(
                      controller: _password,
                      obscureText: true,
                      validator: (v) {
                        final val = v ?? '';
                        if (_user == null && val.length < 8) {
                          return 'Password must be at least 8 characters.';
                        }
                        if (val.isNotEmpty && val.length < 8) {
                          return 'Password must be at least 8 characters.';
                        }
                        return null;
                      },
                    ),
                  ),
                  LabeledField(
                    label: 'Type',
                    child: DropdownButtonFormField<String>(
                      initialValue: _type,
                      items: const [
                        DropdownMenuItem(value: 'admin', child: Text('Admin')),
                        DropdownMenuItem(
                            value: 'doctor', child: Text('Doctor')),
                      ],
                      onChanged: (v) => setState(() => _type = v ?? 'admin'),
                    ),
                  ),
                  LabeledField(
                    label: 'Role',
                    child: DropdownButtonFormField<String>(
                      initialValue: _roleId,
                      isExpanded: true,
                      hint: const Text('Select role…'),
                      items: _roles
                          .map((r) => DropdownMenuItem(
                              value: r.id, child: Text(r.name)))
                          .toList(),
                      onChanged: (v) => setState(() => _roleId = v),
                    ),
                  ),
                  if (_type == 'doctor')
                    LabeledField(
                      label: 'Linked doctor profile',
                      child: DropdownButtonFormField<String>(
                        initialValue: _doctorId,
                        isExpanded: true,
                        hint: const Text('Select doctor…'),
                        items: _doctors
                            .map((d) => DropdownMenuItem(
                                value: d.id, child: Text(d.name)))
                            .toList(),
                        onChanged: (v) => setState(() => _doctorId = v),
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
                              child: CircularProgressIndicator(
                                  strokeWidth: 2.2, color: Colors.white))
                          : const Text('Save'),
                    ),
                  ),
                ],
              ),
            ),
    );
  }
}
