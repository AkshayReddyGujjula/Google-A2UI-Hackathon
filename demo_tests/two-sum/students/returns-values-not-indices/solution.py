"""Student submission: returns the two VALUES instead of their indices."""


def two_sum(nums, target):
    seen = set()
    for n in nums:
        if target - n in seen:
            return [target - n, n]   # bug: values, not indices
        seen.add(n)
    return []
