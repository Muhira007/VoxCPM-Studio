from __future__ import annotations

import os
import sys
import wave
from array import array
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class MergedWave:
    output_path: Path
    duration: float
    sample_rate: int


def _normalized_pcm16(frames: bytes, target_peak: int, maximum_gain: float) -> bytes:
    samples = array("h")
    samples.frombytes(frames)
    if sys.byteorder == "big":
        samples.byteswap()
    peak = max((abs(sample) for sample in samples), default=0)
    if peak:
        gain = min(maximum_gain, target_peak / peak)
        samples = array(
            "h",
            (
                max(-32768, min(32767, round(sample * gain)))
                for sample in samples
            ),
        )
    if sys.byteorder == "big":
        samples.byteswap()
    return samples.tobytes()


def merge_pcm16_wavs(
    inputs: list[Path],
    pauses_ms: list[int],
    output_path: Path,
    *,
    target_peak: int = 29_204,
    maximum_gain: float = 3.0,
) -> MergedWave:
    if not inputs or len(inputs) != len(pauses_ms):
        raise ValueError("WAV inputs and pauses must be non-empty and have equal length.")
    if not 1 <= target_peak <= 32767 or maximum_gain < 1:
        raise ValueError("Invalid WAV normalization settings.")

    parameters: tuple[int, int, int] | None = None
    chunks: list[bytes] = []
    total_frames = 0
    for path, pause_ms in zip(inputs, pauses_ms, strict=True):
        if pause_ms < 0 or pause_ms > 2000:
            raise ValueError("Segment pause must be between 0 and 2000 ms.")
        with wave.open(str(path), "rb") as source:
            current = (source.getnchannels(), source.getsampwidth(), source.getframerate())
            if source.getcomptype() != "NONE" or current[1] != 2:
                raise ValueError("Segment WAV must use uncompressed 16-bit PCM.")
            if parameters is None:
                parameters = current
            elif current != parameters:
                raise ValueError("All segment WAV files must share channels and sample rate.")
            frame_count = source.getnframes()
            frames = _normalized_pcm16(source.readframes(frame_count), target_peak, maximum_gain)
            chunks.append(frames)
            total_frames += frame_count
        channels, sample_width, sample_rate = parameters
        pause_frames = round(sample_rate * pause_ms / 1000)
        if pause_frames:
            chunks.append(bytes(pause_frames * channels * sample_width))
            total_frames += pause_frames

    assert parameters is not None
    channels, sample_width, sample_rate = parameters
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = output_path.with_suffix(f"{output_path.suffix}.{os.getpid()}.tmp")
    try:
        with wave.open(str(temporary), "wb") as target:
            target.setnchannels(channels)
            target.setsampwidth(sample_width)
            target.setframerate(sample_rate)
            for chunk in chunks:
                target.writeframes(chunk)
        os.replace(temporary, output_path)
    finally:
        temporary.unlink(missing_ok=True)
    return MergedWave(output_path, total_frames / sample_rate, sample_rate)
