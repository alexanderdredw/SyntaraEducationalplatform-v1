FROM python:3.12-slim
RUN pip install --no-cache-dir oletools==0.60.2
WORKDIR /app
COPY server.py .
EXPOSE 8080
USER nobody
CMD ["python", "server.py"]
