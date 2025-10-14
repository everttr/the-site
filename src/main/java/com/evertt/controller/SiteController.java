package com.evertt.controller;

import java.time.LocalDate;
import java.util.List;

import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;

import com.evertt.util.FormattingUtil;
import com.evertt.util.RandomUtil;

import jakarta.servlet.http.HttpServletResponse;

@Controller
public class SiteController {
    // Redirect to home
    @GetMapping(value = "/")
    public void redirectToHome(HttpServletResponse resp) {
        resp.setHeader("Location", "/home");
        resp.setStatus(302);
    }
    // Base page
    @GetMapping(value = "/home")
    public String home(Model model) {
        applyDefaultContextToMovel(model);
        model.addAttribute("pageList", PAGE_REFS);
        model.addAttribute("splashText", RandomUtil.item(SPLASH_TEXTS));
        return "home";
    }

    // Flavor text that's mostly there to test/show off thymeleaf's capabilities
    private static final String[] SPLASH_TEXTS = new String[] {
        "HEEEEEELP ME",
        "I'M TRAPPED IN THE MACHINE!",
        "The Site Consumes All.",
        "Do NOT add an 'h' after the 's'!",
        "BREAKING: JavaScript outlawed in all UN member countries!",
        "BREAKING: Constantinople falls!",
    };

    // References to other pages needed by the home page
    private static class PageRef {
        public String title;
        public String id;
        public String fragment;
        public String description;
        public PageRef(String title, String id, String fragment, String description) {
            this.title = title;
            this.id = id;
            this.fragment = fragment;
            this.description = description;
        }
    }
    private static final List<PageRef> PAGE_REFS = List.of(
        // this way of referencing fragments "unwrapped" is depricated, however as far as I'm aware there's no way to have a nested
        // expression inside of the ~{wrapped fragments}, so I guess I'll have to live with the billion warning messages.
        new PageRef("Test Page #1", "test1", "fragments/pages/test1", "The first test page. Unfortunately, this one is the worst..."),
        new PageRef("Test Page #2", "test2", "fragments/pages/test2", "The second(!) test page. This one is the best!"),
        new PageRef("Test Page #3", "test3", "fragments/pages/test3", "The third test page. This one has some quality that rhymes with \"best\", because I guess we're going with an ABB scheme???")
    );

    // Attributes, etc. needed for most page renders
    private void applyDefaultContextToMovel(Model model) {
        var date = LocalDate.now();
        model.addAttribute("month", FormattingUtil.toOrdinal(date.getMonth().ordinal()));
        model.addAttribute("day", FormattingUtil.toOrdinal(date.getDayOfMonth()));
        model.addAttribute("year", FormattingUtil.toOrdinal(date.getYear()));
    }

}
