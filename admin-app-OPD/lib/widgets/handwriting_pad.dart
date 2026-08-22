import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../theme.dart';

/// One sampled point along a stroke — position plus the width to draw there.
class StrokePoint {
  final Offset offset;
  final double width;
  const StrokePoint(this.offset, this.width);
}

class Stroke {
  final List<StrokePoint> points;
  final bool isEraser;
  Stroke(this.isEraser) : points = [];
}

/// Holds the drawing and rasterises it directly to a transparent PNG.
class HandwritingController extends ChangeNotifier {
  final List<Stroke> _strokes = [];
  bool _erasing = false;

  bool get erasing => _erasing;
  List<Stroke> get strokes => _strokes;

  /// True once there is at least one pen (non-eraser) stroke to issue.
  bool get hasContent => _strokes.any((s) => !s.isEraser && s.points.isNotEmpty);

  void setErasing(bool value) {
    _erasing = value;
    notifyListeners();
  }

  void startStroke(StrokePoint p) {
    _strokes.add(Stroke(_erasing)..points.add(p));
    notifyListeners();
  }

  void extendStroke(StrokePoint p) {
    if (_strokes.isEmpty) return;
    _strokes.last.points.add(p);
    notifyListeners();
  }

  void undo() {
    if (_strokes.isNotEmpty) {
      _strokes.removeLast();
      notifyListeners();
    }
  }

  void clear() {
    if (_strokes.isNotEmpty) {
      _strokes.clear();
      notifyListeners();
    }
  }

  /// Rasterise the canvas directly to a transparent PNG.
  Future<Uint8List?> export() async {
    if (_strokes.isEmpty) return null;

    double maxX = 0;
    double maxY = 0;
    for (final s in _strokes) {
      for (final p in s.points) {
        if (p.offset.dx > maxX) maxX = p.offset.dx;
        if (p.offset.dy > maxY) maxY = p.offset.dy;
      }
    }

    final outW = maxX > 500 ? (maxX + 40).clamp(515.0, 2000.0) : 1030.0;
    final outH = maxY > 500 ? (maxY + 40).clamp(507.0, 2500.0) : 1014.0;

    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder, Rect.fromLTWH(0, 0, outW, outH));

    final painter = _PadPainter(_strokes);
    painter.paint(canvas, Size(outW, outH));

    final picture = recorder.endRecording();
    final image = await picture.toImage(outW.toInt(), outH.toInt());
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    return data?.buffer.asUint8List();
  }
}

/// A pen-on-paper drawing surface for prescriptions. Captures stylus/finger
/// strokes with pen/eraser tools, undo, clear and a single fullscreen shortcut.
class HandwritingPad extends StatelessWidget {
  final HandwritingController controller;
  final bool enabled;
  final VoidCallback? onOpenFullscreen;

  static const double _penBase = 2.6;
  static const double _eraserWidth = 26;

  const HandwritingPad({
    super.key,
    required this.controller,
    this.enabled = true,
    this.onOpenFullscreen,
  });

  double get _strokeWidth => controller.erasing ? _eraserWidth : _penBase;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _toolbar(context),
        const SizedBox(height: 10),
        Container(
          height: 440,
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(AppRadius.control),
            border: Border.all(color: AppColors.border, width: 0.5),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.03),
                blurRadius: 6,
                offset: const Offset(0, 2),
              ),
            ],
          ),
          clipBehavior: Clip.antiAlias,
          child: GestureDetector(
            behavior: HitTestBehavior.opaque,
            onPanStart: enabled
                ? (d) => controller.startStroke(
                    StrokePoint(d.localPosition, _strokeWidth))
                : null,
            onPanUpdate: enabled
                ? (d) => controller.extendStroke(
                    StrokePoint(d.localPosition, _strokeWidth))
                : null,
            child: AnimatedBuilder(
              animation: controller,
              builder: (_, _) => CustomPaint(
                painter: _PadPainter(controller.strokes),
                size: Size.infinite,
              ),
            ),
          ),
        ),
        const SizedBox(height: 6),
        const Text(
          'Write with stylus or finger. Use "Full Screen" for large writing area.',
          style: TextStyle(color: AppColors.textSecondary, fontSize: 11.5),
        ),
      ],
    );
  }

  void _openFullscreen(BuildContext context) {
    Navigator.push(
      context,
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => FullScreenHandwritingScreen(
          controller: controller,
          enabled: enabled,
        ),
      ),
    );
  }

  Widget _toolbar(BuildContext context) {
    return AnimatedBuilder(
      animation: controller,
      builder: (context, _) => Wrap(
        spacing: 8,
        runSpacing: 8,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          _toolButton(
            icon: Icons.edit,
            label: 'Pen',
            active: !controller.erasing,
            onTap: enabled ? () => controller.setErasing(false) : null,
          ),
          _toolButton(
            icon: Icons.auto_fix_normal,
            label: 'Eraser',
            active: controller.erasing,
            onTap: enabled ? () => controller.setErasing(true) : null,
          ),
          OutlinedButton.icon(
            onPressed: enabled ? controller.undo : null,
            icon: const Icon(Icons.undo, size: 16),
            label: const Text('Undo'),
          ),
          OutlinedButton.icon(
            onPressed: enabled ? controller.clear : null,
            icon: const Icon(Icons.delete_outline, size: 16),
            label: const Text('Clear'),
          ),
          OutlinedButton.icon(
            onPressed: onOpenFullscreen ?? () => _openFullscreen(context),
            icon: const Icon(Icons.fullscreen, size: 16),
            label: const Text('Full Screen'),
          ),
        ],
      ),
    );
  }

  Widget _toolButton({
    required IconData icon,
    required String label,
    required bool active,
    required VoidCallback? onTap,
  }) {
    return active
        ? ElevatedButton.icon(
            onPressed: onTap,
            icon: Icon(icon, size: 16),
            label: Text(label),
          )
        : OutlinedButton.icon(
            onPressed: onTap,
            icon: Icon(icon, size: 16),
            label: Text(label),
          );
  }
}

/// Dedicated full-screen whiteboard screen without any outer scroll containers.
class FullScreenHandwritingScreen extends StatefulWidget {
  final HandwritingController controller;
  final bool enabled;
  final VoidCallback? onIssue;

  const FullScreenHandwritingScreen({
    super.key,
    required this.controller,
    this.enabled = true,
    this.onIssue,
  });

  @override
  State<FullScreenHandwritingScreen> createState() =>
      _FullScreenHandwritingScreenState();
}

class _FullScreenHandwritingScreenState
    extends State<FullScreenHandwritingScreen> {
  static const double _penBase = 2.6;
  static const double _eraserWidth = 28;

  double get _strokeWidth =>
      widget.controller.erasing ? _eraserWidth : _penBase;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: Colors.white,
        foregroundColor: AppColors.text,
        elevation: 1,
        titleSpacing: 0,
        title: const Row(
          children: [
            Icon(Icons.draw_outlined, size: 20, color: AppColors.primary),
            SizedBox(width: 8),
            Text(
              'Handwriting Whiteboard',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
            ),
          ],
        ),
        actions: [
          AnimatedBuilder(
            animation: widget.controller,
            builder: (context, _) => Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                IconButton(
                  tooltip: 'Pen',
                  icon: Icon(
                    Icons.edit,
                    color: !widget.controller.erasing
                        ? AppColors.primary
                        : AppColors.textSecondary,
                  ),
                  onPressed: widget.enabled
                      ? () => widget.controller.setErasing(false)
                      : null,
                ),
                IconButton(
                  tooltip: 'Eraser',
                  icon: Icon(
                    Icons.auto_fix_normal,
                    color: widget.controller.erasing
                        ? AppColors.error
                        : AppColors.textSecondary,
                  ),
                  onPressed: widget.enabled
                      ? () => widget.controller.setErasing(true)
                      : null,
                ),
                IconButton(
                  tooltip: 'Undo',
                  icon: const Icon(Icons.undo),
                  onPressed: widget.enabled ? widget.controller.undo : null,
                ),
                IconButton(
                  tooltip: 'Clear',
                  icon: const Icon(Icons.delete_outline),
                  onPressed: widget.enabled ? widget.controller.clear : null,
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: ElevatedButton.icon(
              onPressed: () => Navigator.pop(context),
              icon: const Icon(Icons.check, size: 16),
              label: const Text('Done'),
            ),
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: Container(
                width: double.infinity,
                color: Colors.white,
                child: GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onPanStart: widget.enabled
                      ? (d) => widget.controller.startStroke(
                          StrokePoint(d.localPosition, _strokeWidth))
                      : null,
                  onPanUpdate: widget.enabled
                      ? (d) => widget.controller.extendStroke(
                          StrokePoint(d.localPosition, _strokeWidth))
                      : null,
                  child: AnimatedBuilder(
                    animation: widget.controller,
                    builder: (_, _) => CustomPaint(
                      painter: _PadPainter(widget.controller.strokes),
                      size: Size.infinite,
                    ),
                  ),
                ),
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              decoration: const BoxDecoration(
                color: AppColors.page,
                border: Border(top: BorderSide(color: AppColors.border, width: 0.5)),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text(
                    '✍️ Full screen active — resting your hand will not scroll.',
                    style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
                  ),
                  TextButton(
                    onPressed: () => Navigator.pop(context),
                    child: const Text('Close Fullscreen'),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PadPainter extends CustomPainter {
  final List<Stroke> strokes;
  _PadPainter(this.strokes);

  @override
  void paint(Canvas canvas, Size size) {
    canvas.saveLayer(Offset.zero & size, Paint());
    for (final stroke in strokes) {
      final paint = Paint()
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round
        ..style = PaintingStyle.stroke
        ..isAntiAlias = true;
      if (stroke.isEraser) {
        paint.blendMode = BlendMode.clear;
      } else {
        paint.color = const Color(0xFF16324F); // deep ink blue
      }

      final pts = stroke.points;
      if (pts.length == 1) {
        paint.strokeWidth = pts.first.width;
        canvas.drawPoints(ui.PointMode.points, [pts.first.offset], paint);
        continue;
      }
      for (var i = 0; i < pts.length - 1; i++) {
        paint.strokeWidth = (pts[i].width + pts[i + 1].width) / 2;
        canvas.drawLine(pts[i].offset, pts[i + 1].offset, paint);
      }
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(_PadPainter oldDelegate) => true;
}
