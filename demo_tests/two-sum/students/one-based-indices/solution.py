"""Student submission: correct pair, but returns 1-based indices (off by one)."""


def two_sum(nums, target):
    seen = {}
    for i, n in enumerate(nums):
        if target - n in seen:
            return [seen[target - n] + 1, i + 1]   # bug: 1-based
        seen[n] = i
    return []
