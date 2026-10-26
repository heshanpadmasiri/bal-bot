function demo(int value) returns int {
    int count = nextValue(value);
    if count > 2 {
        count -= 1;
    } else {
        count += 2;
    }
    return count;
}

function nextValue(int value) returns int {
    return value + 1;
}
