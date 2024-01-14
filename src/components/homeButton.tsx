import React, { useState, FC } from "react"
import Link from "next/link"
import { Icons } from "./icons"
import { Button } from "./ui/button"

const HomeButton: FC = () => {
  return (
    <Link href="/" id="homeButton">
      <Button variant="secondary" size="icon">
        <Icons.left />
      </Button>
    </Link>
  )
}

export default HomeButton
