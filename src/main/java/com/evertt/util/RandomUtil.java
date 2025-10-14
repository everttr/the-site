package com.evertt.util;

import java.util.List;
import java.util.Random;

// Just a wrapper for a global random object
// (Mostly for fun. Not trying to be cryptographically secure)
public class RandomUtil {
    public static final Random r;

    static {
        r = new Random();
    }

    public static int i(int min, int maxExclusive) {
        return r.nextInt(min, maxExclusive);
    }

    public static double d(double min, double max) {
        return r.nextDouble(min, max);
    }

    public static float f(float min, float max) {
        return r.nextFloat(min, max);
    }

    public static boolean b() {
        return r.nextBoolean();
    }
    public static boolean b(double chanceTrue) {
        return r.nextDouble() < chanceTrue;
    }

    public static <T> T item(List<T> l) {
        return l.get(r.nextInt(0, l.size()));
    }
    public static <T> T item(T[] a) {
        return a[r.nextInt(0, a.length)];
    }
}
