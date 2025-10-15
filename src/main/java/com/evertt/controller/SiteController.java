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
        model.addAttribute("email", EMAIL);
        return "home";
    }

    // Constants in case I never need to change them
    private static final String EMAIL = "reed@evertt.com";

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
        new PageRef("This Site", "the-site", "fragments/pages/the-site", "Indeed! The very site you're on! Built with SpringBoot and Thymeleaf, deployed on an AWS EC2 server, equiped with CI/CD using GitHub actions, and not to mention those wonderful shaders in the background!"),
        new PageRef("Unity Games", "games", "fragments/pages/games", "Two published games (and many more unpublished...) built in Unity with C#, HLSL, custom sprites, models, sounds, and everything else - never used a premade asset in my life."),
        new PageRef("Game Modding", "mods", "fragments/pages/mods", "I've also created many mods and plugins for other games (mostly Minecraft). One in particular I spent three months on full-time; it's the most complex enemy AI I've ever made!"),
        new PageRef("Blender Work", "blender", "fragments/pages/blender", "Over the past 5 years, I've been working on an 10-hour long experimental animated film. And you know me, it's full of insanely complex geometry shaders.")
    );

    // Attributes, etc. needed for most page renders
    private void applyDefaultContextToMovel(Model model) {
        var date = LocalDate.now();
        model.addAttribute("month", FormattingUtil.toOrdinal(date.getMonth().ordinal()));
        model.addAttribute("day", FormattingUtil.toOrdinal(date.getDayOfMonth()));
        model.addAttribute("year", FormattingUtil.toOrdinal(date.getYear()));
    }

}
