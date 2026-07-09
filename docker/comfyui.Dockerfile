# ComfyUI CPU-only, usado quando a VPS nao tem GPU (perfil "vps" do
# docker-compose.yml). python:3.11-slim evita o problema do Python 3.9
# padrao em distros RHEL (ComfyUI exige >=3.10 por causa do pacote "av").
FROM python:3.11-slim

RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
    git libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN git clone --depth 1 https://github.com/comfyanonymous/ComfyUI.git .

# torchaudio precisa vir do indice CPU explicitamente - sem isso, "pip
# install -r requirements.txt" (que lista torchaudio sem pin) resolve pra
# build CUDA padrao do PyPI, que falha em runtime (libcudart.so ausente)
# num container sem GPU.
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir -r requirements.txt

EXPOSE 8188
ENTRYPOINT ["python", "main.py", "--listen", "0.0.0.0", "--port", "8188", "--cpu", "--disable-auto-launch"]
