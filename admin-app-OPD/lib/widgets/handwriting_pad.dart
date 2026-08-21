import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';

import '../theme.dart';

/// One sampled point along a stroke — position plus the width to draw there
/// (derived from stylus pressure, so the line swells like a real pen).
class _StrokePoint {
  final Offset offset;
  final double width;
  const _StrokePoint(this.offset, this.width);
}

class _Stroke {
  final List<_StrokePoint> points;
  final bool isEraser;
  _Stroke(this.isEraser) : points = [];
}

/// Holds the drawing and can rasterise it to a transparent PNG. The parent keeps
/// one of these and calls [export] when the doctor issues the prescription.
class HandwritingController extends ChangeNotifier {
  final GlobalKey repaintKey = GlobalKey();
  final List<_Stroke> _strokes = [];
  bool _erasing = false;

  bool get erasing => _erasing;
  List<_Stroke> get strokes => _strokes;

  /// True once there is at least one pen (non-eraser) stroke to issue.
  bool get hasContent => _strokes.any((s) => !s.isEraser && s.points.isNotEmpty);

  void setErasing(bool value) {
    _erasing = value;
    notifyListeners();
  }

  void startStroke(_StrokePoint p) {
    _strokes.add(_Stroke(_erasing)..points.add(p));
    notifyListeners();
  }

  void extendStroke(_StrokePoint p) {
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

  /// Rasterise the canvas to a transparent PNG at high resolution.
  Future<Uint8List?> export() async {
    final boundary = repaintKey.currentContext?.findRenderObject()
        as RenderRepaintBoundary?;
    if (boundary == null) return null;
    final image = await boundary.toImage(pixelRatio: 3.0);
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    return data?.buffer.asUint8List();
  }
}

/// A pen-on-paper drawing surface for prescriptions. Captures stylus/finger
/// strokes (pressure-sensitive where the hardware supports it), with pen/eraser
/// tools, undo and clear. The writable area matches the A4 body region so what
/// the doctor draws maps onto their letterhead in the PDF.
class HandwritingPad extends StatelessWidget {
  final HandwritingController controller;
  final bool enabled;

  // The PDF body area is ~515 × 507 pt; matching that keeps the drawing true.
  static const double _aspect = 515 / 507;
  static const double _penBase = 2.6;
  static const double _eraserWidth = 26;

  const HandwritingPad({
    super.key,
    required this.controller,
    this.enabled = true,
  });

  double _widthFor(PointerEvent e) {
    if (controller.erasing) return _eraserWidth;
    // pressure is 1.0 on devices without pressure support, so finger/mouse get
    // a steady line while a stylus tapers with how hard the doctor presses.
    final p = e.pressure.clamp(0.0, 1.0);
    return _penBase * (0.6 + p * 0.9);
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _toolbar(),
        const SizedBox(height: 10),
        AspectRatio(
          aspectRatio: _aspect,
          child: Container(
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(AppRadius.control),
              border: Border.all(color: AppColors.border, width: 0.5),
            ),
            clipBehavior: Clip.antiAlias,
            child: Listener(
              behavior: HitTestBehavior.opaque,
              onPointerDown: enabled
                  ? (e) => controller.startStroke(
                      _StrokePoint(e.localPosition, _widthFor(e)))
                  : null,
              onPointerMove: enabled
                  ? (e) => controller.extendStroke(
                      _StrokePoint(e.localPosition, _widthFor(e)))
                  : null,
              child: RepaintBoundary(
                key: controller.repaintKey,
                child: AnimatedBuilder(
                  animation: controller,
                  builder: (_, _) => CustomPaint(
                    painter: _PadPainter(controller.strokes),
                    size: Size.infinite,
                  ),
                ),
              ),
            ),
          ),
        ),
        const SizedBox(height: 6),
        const Text(
          'Write with your stylus. This prints on your letterhead when issued.',
          style: TextStyle(color: AppColors.textSecondary, fontSize: 11.5),
        ),
      ],
    );
  }

  Widget _toolbar() {
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

class _PadPainter extends CustomPainter {
  final List<_Stroke> strokes;
  _PadPainter(this.strokes);

  @override
  void paint(Canvas canvas, Size size) {
    // saveLayer lets eraser strokes actually cut transparency into the drawing,
    // so the exported PNG has real holes rather than white paint.
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
