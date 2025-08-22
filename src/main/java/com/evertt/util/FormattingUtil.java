package com.evertt.util;

public class FormattingUtil {
    public static String toOrdinal(int i) {
        String suffix = switch (Math.abs(i) % 10) {
            case 1 -> "st";
            case 2 -> "nd";
            case 3 -> "rd";
            default -> "th";
        };
        return Integer.toString(i) + suffix;
    }
}
