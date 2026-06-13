# Lab 5 — Two Sum

**Course:** CS101 Introduction to Programming
**Language:** Python 3
**Topic:** Arrays & hashing

## Task

Given a list of integers `nums` and an integer `target`, return the **indices** of the
two numbers that add up to `target`:

```python
def two_sum(nums: list[int], target: int) -> list[int]:
    ...
```

- Return a list of the two **indices** `[i, j]` (order does not matter).
- You may assume **exactly one** valid pair exists.
- You may **not** use the same element twice (the two indices must be different).

Example: `two_sum([2, 7, 11, 15], 9)` returns `[0, 1]` because `nums[0] + nums[1] == 9`.

## What we assess

1. Correctness — returns the indices of a valid pair on all test inputs.
2. Handling of tricky inputs — duplicate values, negative numbers, the pair at the ends.
3. Returns **indices**, not the values, and never reuses one element.
