# Notice

한국어판은 원본 [vishalmysore/layaAgent](https://github.com/vishalmysore/layaAgent)(Apache-2.0)의 파생 저작물입니다. 아래 고지는 원본의 것을 유지하고, 한국어판에서 추가된 부분을 덧붙였습니다.

layaAgent is an unofficial project built on a browser port of the Laya typed-decisions checkpoint. It is not affiliated with or endorsed by ConvAI Innovations, Microsoft, Hugging Face, Answer.AI, LightOn, the MLC team, Alibaba (Qwen), Meta (Llama), the Wikimedia Foundation, Open-Meteo or the Cytoscape Consortium.

## This project

The agent loop, gate, candidate extractor, tools, task suite, evaluation and pages in this repository are Copyright 2026 vishalmysore and licensed under the Apache License, Version 2.0 (see `LICENSE`).

## System 1: the Laya model

한국어판: the page loads [`convaiinnovations/laya-multilingual`](https://huggingface.co/convaiinnovations/laya-multilingual) at runtime, through a GitHub Pages mirror (`https://realizer-1966.github.io/laya-web-ko/model-multilingual/`) built by the [laya-web-ko](https://github.com/realizer-1966/laya-web-ko) project. That checkpoint is a Laya derivative trained on the mmBERT-base encoder (100+ languages, Apache-2.0); its own `LICENSE`/`NOTICE` live in the model repository.

원본(영어) 빌드: the page loads [`VishalMysore/layaForWebTrained`](https://huggingface.co/VishalMysore/layaForWebTrained) at runtime. That is a modified derivative of [`convaiinnovations/laya-typed-decisions`](https://huggingface.co/convaiinnovations/laya-typed-decisions) (Copyright ConvAI Innovations, Apache-2.0), exported to ONNX and quantized by the [layaForWeb](https://github.com/vishalmysore/layaForWeb) project. Laya is built on ModernBERT-large by Answer.AI and LightOn (Apache-2.0). The model files are not part of this repository; their own `LICENSE` and `NOTICE.md` are in the model repository.

`web/laya-core.js` and `web/model.js` are copied unchanged from [layaForWorkflows](https://github.com/vishalmysore/layaForWorkflows) (which took them from layaForWeb, with the calibration temperature clamped to [0.5, 5.0] like upstream `clamp_temperature`). `laya-core.js` is a JavaScript port of the Python `laya/common.py` (`build_sequence`) and `laya/agent.py` (`system_one`) from https://github.com/NandhaKishorM/laya (Apache-2.0).

## System 2: WebLLM models

System 2 models are downloaded at runtime by WebLLM from the MLC model repositories on Hugging Face and are not part of this repository. Each is under its own license: Qwen2.5 Instruct 0.5B / 1.5B (Apache-2.0, Alibaba Cloud), Llama 3.2 1B Instruct (Llama 3.2 Community License, Meta; "Built with Llama"). Check the license of the model you load.

## Data

한국어판: `web/tasks.json`은 한국어 합성 과제 세트입니다 (68개 목표, 147단계). 목표·메모·이름은 지어낸 것이고, 관찰 결과는 `scripts/build_tasks_ko.mjs`가 한국어 위키백과(`ko.wikipedia.org`, CC BY-SA 4.0)·Wikidata(CC0)·Open-Meteo(CC BY 4.0)에서 한 번씩 실행해 녹음했습니다. `web/ko.js`의 고유명사 사전은 공개 지명·인물·기업 이름만 담은 손으로 쓴 목록입니다.

`web/tasks.json` is a synthetic task suite written for this project: goals, saved notes and message recipients are made up. Its observations were recorded once from the public APIs the tools call: Wikipedia page summaries (text under CC BY-SA 4.0, Wikipedia contributors), Wikidata statements (CC0) and Open-Meteo forecasts (CC BY 4.0, open-meteo.com). `web/recorded.json` holds runs recorded from the same models so the pages can show results before anything is downloaded. **한국어판에는 아직 이 녹음 파일이 없습니다** (브라우저에서 모델을 불러와 직접 녹음해야 합니다).

At run time the tools call Wikipedia (ko.wikipedia.org in this edition), Wikidata and Open-Meteo directly from the visitor's browser. `send_message` is simulated and never sends anything.

## Third-party software shipped with the page (`vendor/`)

- **ONNX Runtime Web** (`onnxruntime-web` 1.30.0): Copyright (c) Microsoft Corporation, MIT License. `licenses/onnxruntime-LICENSE.txt`; notices for components inside the WebAssembly binary are in `licenses/onnxruntime-ThirdPartyNotices.txt`.
- **Tokenizers.js** (`@huggingface/tokenizers` 0.2.0): Hugging Face, Apache License 2.0. `licenses/tokenizers.js-LICENSE.txt`.
- **Cytoscape.js** (`cytoscape` 3.34.3): Copyright (c) The Cytoscape Consortium, MIT License. `licenses/cytoscape-LICENSE.txt`.
- **cytoscape-dagre** (`cytoscape-dagre` 4.0.1, which bundles dagre and graphlib by Chris Pettitt, MIT): MIT License. `licenses/cytoscape-dagre-LICENSE.txt`.
- **compromise** (`compromise` 14.17.0) and **compromise-dates** (`compromise-dates` 3.9.0): Copyright (c) Spencer Kelly, MIT License. `licenses/compromise-LICENSE.txt`, `licenses/compromise-dates-LICENSE.txt`.
- **WebLLM** (`@mlc-ai/web-llm` 0.2.79): MLC, Apache License 2.0. `licenses/web-llm-LICENSE.txt`.
