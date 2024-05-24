{% extends "layout.njk" %}

{% block article %}

# Flexbox  Composition

Flexbox is one of the most important responsive HTML element display formats. Flexbox is powerful, straightforward to get started with, and works well with responsive content. The critical thing to remember about Flexbox is that it is flexible and helps us place elements in lines, rows, and columns.

This guide to CSS Flexbox layout explains everything about Flexbox, focusing on all the different possible properties for the parent element (the flex container) and the child elements. It also includes history, demos, patterns, and a browser support chart.

###  Table of contents

1.  [[#Background]]
2.  [[#Basics and terminology]]
3. [[#Flexbox properties]]

###   Get our Flexbox poster!

Do you reference this guide a lot? Here’s a high-res image you can print!

[DOWNLOAD FREE](Projects/Curriculum/Startr.Style/attachments/Flexbox-poster.jpg) 

![[flexbox_poster.jpg]]

---

### Background

(https://www.w3.org/TR/css-flexbox/)


### Basics and terminology

![[flexbox_example_terminology.svg]]
### How to create a flexbox element

Any element with the display property of flex supplied is a flexbox. Its child elements or flex items will follow flex box rules for laying them out in a line. These lines follow the main axis and can be pushed against the cross-axis. Let's get started.

### Flexbox properties

![[flexbox_example_container.svg]]

## Properties for the Parent  
(flex container)

### display

Depending on the given value, this defines a flex container as `inline-flex` or block `flex`. It enables flexible or `flex` styling for all its direct children.

```css
.container {
  display: flex; /* or inline-flex */
}
```

> Note that CSS [columns](https://developer.mozilla.org/en-US/docs/Web/CSS/columns) have no effect on a flex container. This is a different but similar layout that is both simpler to implement but less `flex` able ;) . 

###  flex-direction

![[flex.svg]]
This sets the direction in which flex items are placed in the flex container and orients along a central or main axis. Flex items are laid out in horizontal rows or vertical columns. 

```css
.container {
  flex-direction: row | row-reverse | column | column-reverse;
}
```

- `row` (default): left to right for layouts that are `ltr` such as English and Portuguese. With languages such as Hebrew and Arabic (`rtl`) it is right to left. Row always follows the default flow.
- `row-reverse`: This reverses the flow e.g. 
  right to left for layouts that are by default `ltr` 
  left to right for `rtl`, such as Hebrew and Arabic
- `column`: this is like a `row` but instead top to bottom
- `column-reverse`:  bottom to top

###  flex-wrap

![[flex_example_flex-wrap.svg]]
By default, flex items will all try to fit onto one line, a row or a column. You can change that and let the items wrap as needed with this property.

```css
.container {
  flex-wrap: nowrap | wrap | wrap-reverse;
}
```

- `nowrap` (default): all flex items will be on one line.
- `wrap`: flex items will wrap onto multiple lines, along the cross axis. With rows, this is often from top to bottom. 
- `wrap-reverse`: flex items will wrap onto multiple lines from across the cross-axis.

- [ ] _Todo:_ Add [[startr.style]] flex-wrap demos
> There are some [visual demos of `flex-wrap` here](https://css-tricks.com/almanac/properties/f/flex-wrap/).

###  flex-flow

This is a shorthand for the `flex-direction` and `flex-wrap` properties, which define the flex container’s main and cross axes together. The default value is `row nowrap`.

```css
.container {
  flex-flow: column wrap;
}
```

###  justify-content

![[flexbox_justify-content.svg]]
This defines the alignment along the main axis. It helps distribute extra free space left over when either all the flex items on a line are inflexible, or are flexible but have reached their maximum size. It also exerts some control over the alignment of items when they overflow the line.

```css
.container {
  justify-content: flex-start | flex-end | center | space-between | space-around | space-evenly | start | end | left | right ... + safe | unsafe;
}
```

- `flex-start` (default): items are packed toward the start of the flex-direction.
- `flex-end`: items are packed toward the end of the flex-direction.
- `start`: items are packed toward the start of the `writing-mode` direction.
- `end`: items are packed toward the end of the `writing-mode` direction.
- `left`: is shorthand for `start`.
- `right`: is shorthand for `end`.
- `center`: items are centered along the line
- `space-between`: items are evenly distributed in the line; the first item is on the start line, the last item is on the end line
- `space-around`: items are evenly distributed in the line with equal space around them. 
  > Note that visually the spaces aren’t equal since all the items have equal space on both sides. The first item will have one unit of space against the container edge but two units of space between the next item because that next item has its own spacing that applies.
- `space-evenly`: items are distributed so that the spacing between any two items (and the space to the edges) is equal.

> _Note:_ browser support for these values was nuanced in the past. For example, `space-between` never got support from some versions of Edge. MDN [has detailed charts](https://developer.mozilla.org/en-US/docs/Web/CSS/justify-content). The safest values are `flex-start`, `flex-end`, and `center`.

There are also two additional keywords you can pair with these values: `safe` and `unsafe`. Using `safe` ensures that however you do this type of positioning, you can’t push an element such that it renders off-screen (e.g. off the top) in such a way the content can’t be scrolled too (called “data loss”).

###  align-items

![[flexbox_align-items.svg]]
This defines the default behavior for how flex items are laid out along the **cross axis** on the current line. Think of it as the `justify-content` version for the cross-axis (perpendicular to the main-axis).

```css
.container {
  align-items: stretch | flex-start | flex-end | center | baseline | first baseline | last baseline | start | end | self-start | self-end + ... safe | unsafe;
}
```

- `stretch` (default): stretch to fill the container (still respect min-width/max-width)
- `flex-start` / `start` / `self-start`: items are placed at the start of the cross axis. The difference between these is subtle, and is about respecting the `flex-direction` rules or the `writing-mode` rules.
- `flex-end` / `end` / `self-end`: items are placed at the end of the cross axis. The difference again is subtle and is about respecting `flex-direction` rules vs. `writing-mode` rules.
- `center`: items are centered in the cross-axis
- `baseline`: items are aligned such as their baselines align

The `safe` and `unsafe` modifier keywords can be used in conjunction with all the rest of these keywords (although note [browser support](https://developer.mozilla.org/en-US/docs/Web/CSS/align-items)), and deal with helping you prevent aligning elements such that the content becomes inaccessible.

###  align-content

![[flex_example_align-content.svg]]

  
This aligns a flex container’s lines within when there is extra space in the cross-axis, similar to how `justify-content` aligns individual items within the main-axis.

**Note:** This property only takes effect on multi-line flexible containers, where `flex-wrap` is set to either `wrap` or `wrap-reverse`). A single-line flexible container (i.e. where `flex-wrap` is set to its default value, `no-wrap`) will not reflect `align-content`.

```css
.container {
  align-content: flex-start | flex-end | center | space-between | space-around | space-evenly | stretch | start | end | baseline | first baseline | last baseline + ... safe | unsafe;
}
```

- `normal` (default): items are packed in their default position as if no value was set.
- `flex-start` / `start`: items packed to the start of the container. The (more supported) `flex-start` honors the `flex-direction` while `start` honors the `writing-mode` direction.
- `flex-end` / `end`: items packed to the end of the container. The (more support) `flex-end` honors the `flex-direction`, while `end` honors the `writing-mode` direction.
- `center`: items centred in the container
- `space-between`: items evenly distributed; the first line is at the start of the container, while the last one is at the end
- `space-around`: items evenly distributed with equal space around each line
- `space-evenly`: items are evenly distributed with equal space around them
- `stretch`: lines stretch to take up the remaining space

The `safe` and `unsafe` modifier keywords can be used in conjunction with all the rest of these keywords (although note [browser support](https://developer.mozilla.org/en-US/docs/Web/CSS/align-items)) and deal with helping you prevent aligning elements such that the content becomes inaccessible.

###  gap, row-gap, column-gap

![[flexbox_example-gap.svg]]
The `gap` property explicitly controls the space between flex items. It applies that spacing _only between items_ not on the outer edges.

```css
.container {
  display: flex;
  ...
  gap: 10px;
  gap: 10px 20px; /* row-gap column gap */
  row-gap: 10px;
  column-gap: 20px;
}
```

The behaviour could be thought of as a minimum gutter. If the gutter is bigger somehow (because of something like justify-content: space-between;), then the gap will only take effect if that space ends up smaller.

It is not exclusively for flexbox, `gap` works in grid and multi-column layout as well.

![[./attachments/flex_child_elements.svg]]

## Properties for the Children  
(flex items)

###  Order

![[flex_order_eample_01.svg]]

By default, flex items are laid out in the source order. However, the `order` property controls the order in which they appear in the flex container.

```css
.item {
  order: 5; /* default is 0 */
}
```

Items with the same `order` revert to the source order.

###  flex-grow

![[flex_grow_example.svg]]

This defines the ability for a flex item to grow if necessary. It accepts a value without units that serves as a proportion. It dictates what amount of the available space inside the flex container the item should take up.

If all items have `flex-grow` set to `1`, the remaining space in the container will be distributed equally to all children. If one of the children has a value of `2`, that child will take up twice as much space as either of the others (or it will try, at least).

```css
.item {
  flex-grow: 4; /* default 0 */
}
```

Negative numbers are invalid.

###  flex-shrink

This defines the ability for a flex item to shrink if necessary.

```css
.item {
  flex-shrink: 3; /* default 1 */
}
```

Negative numbers are invalid.

###  flex-basis

This defines the default size of an element before the remaining space is distributed. It can be a length (e.g. 20%, 5rem, etc.) or a keyword. The `auto` keyword means “look at my width or height property.” The `content` keyword means “size it based on the item’s content.” – this keyword isn’t well supported yet, so it’s hard to test and to know what its brethren `max-content`, `min-content`, and `fit-content` do.

```css
.item {
  flex-basis:  | auto; /* default auto */
}
```

If set to `0`, the extra space around content isn’t factored in. If set to `auto`, the extra space is distributed based on its `flex-grow` value. [See this graphic.](http://www.w3.org/TR/css3-flexbox/images/rel-vs-abs-flex.svg)

###  flex

This is the shorthand for `flex-grow,` `flex-shrink` and `flex-basis` combined. The second and third parameters (`flex-shrink` and `flex-basis`) are optional. The default is `0 1 auto`, but if you set it with a single number value, like `flex: 5;` that changes the flex-basis to 0%, so it’s like setting flex-grow: 5; flex-shrink: 1; flex-basis: 0%;

```css
.item {
  flex: none | [ <'flex-grow'> <'flex-shrink'>? || <'flex-basis'> ]
}
```

You should use this shorthand property** rather than set the individual properties. The shorthand sets the other values intelligently.

###  align-self

![[flex_example_align-self.svg]]

  
This allows the default alignment (or the one specified by `align-items`) to be overridden for individual flex items.

Please see the explanation for the `align-items` to understand the available values.

```css
.item {
  align-self: auto | flex-start | flex-end | center | baseline | stretch;
}
```

Note that `float`, `clear` and `vertical-align` do not affect a flex item.


### Examples
- [ ] **Todo:** Examples
### Flexbox tricks!
- [ ] **Todo:** Flexbox tricks!

{% endblock %}