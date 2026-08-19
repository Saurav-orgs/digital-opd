FROM python:3.12-slim

# ffmpeg: Whisper audio decoding. tesseract + hin: OCR for photographed reports.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      tesseract-ocr \
      tesseract-ocr-hin \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Model weights are cached here — mount a volume so restarts don't re-download.
ENV HF_HOME=/srv/.cache/huggingface
EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
